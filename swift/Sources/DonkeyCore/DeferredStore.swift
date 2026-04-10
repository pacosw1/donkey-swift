import Foundation
import Network

/// A persistent, batching, backoff-aware queue for fire-and-forget SDK
/// operations.
///
/// Any request the SDK makes that the user is NOT waiting on — analytics
/// events, session start/end reports, device token churn, notification
/// delivery receipts, push-open tracking — should go through this store
/// instead of calling the per-service client directly. That way:
///
///   • Callers are never blocked on a network round-trip: `enqueue` only
///     writes to disk and schedules a flush.
///   • App termination doesn't drop in-flight telemetry. The queue is
///     persisted to `Application Support/<name>.json` (customizable) on
///     every mutation and replayed on launch via `bootstrap()`.
///   • A flaky or offline connection becomes exponential backoff (base
///     `baseBackoff`, doubling up to `maxBackoff`) instead of dropped
///     items. `NWPathMonitor` kicks the flush loop immediately when
///     connectivity returns.
///   • Items of the same kind batch together: the registered handler
///     receives up to `batchSize` serialized payloads per call, so a
///     burst of analytics events turns into a single HTTP request.
///   • A single malformed or always-rejected item can't jam the queue.
///     After `maxAttempts` failed tries an item is dead-lettered (logged
///     + dropped) and subsequent items keep flowing.
///
/// ## What belongs here vs. direct SDK calls
///
/// Use `DeferredStore` for:
///   • `engage.trackEvents` — high volume, batchable, user never waits
///   • `engage.reportSession(.start/.end)` — no UI branch on the ACK
///   • `notify.registerDevice` / `notify.disableDevice` — fires on token
///     rotation, retry-safe
///   • Push-open receipts, notification-delivered pings, and similar
///     "we'd like the server to know, but the user doesn't care"
///
/// Do NOT use `DeferredStore` for:
///   • `auth.signInWithApple`, `auth.refresh`, `auth.me`
///   • `flags.evaluate` — needed to render the UI
///   • `chat.sendMessage`, chat history fetches — user is waiting
///   • `paywall.get`, `receipt.verify` — branches on success/failure
///   • Any call whose result the app displays or branches on
///
/// ## Usage
///
/// Register a handler for each kind you plan to enqueue, ONCE at app
/// startup. The handler receives a `[Data]` batch of JSON-encoded
/// payloads and is responsible for decoding + making the SDK call:
///
/// ```swift
/// let store = DeferredStore.shared
/// await store.register(kind: "engage.event", batchSize: 50) { dataItems in
///     let events = dataItems.compactMap {
///         try? JSONDecoder().decode(EngageEvent.self, from: $0)
///     }
///     _ = try await engageClient.trackEvents(events)
/// }
/// await store.bootstrap()
/// ```
///
/// Then enqueue from anywhere:
///
/// ```swift
/// await DeferredStore.shared.enqueue(
///     kind: "engage.event",
///     payload: EngageEvent(event: "screen_view", metadata: "{\"screen\":\"home\"}")
/// )
/// ```
///
/// The store persists immediately, flushes on the next loop tick, batches
/// with other ready "engage.event" items, retries on failure, and drops
/// the items once the handler returns without throwing.
///
/// ## Thread model
///
/// `DeferredStore` is an actor — all mutations serialize automatically.
/// Handler invocations run on the actor's executor too, so a handler
/// cannot race with enqueue/persist.
public actor DeferredStore {

    // MARK: Public — singleton

    /// The process-wide default store. Apps should use this from every
    /// enqueue site; multiple stores are supported for tests but are
    /// rarely needed in production.
    public static let shared = DeferredStore()

    // MARK: Public — types

    /// A registered flush handler. Takes a batch of serialized payloads
    /// (up to the kind's `batchSize`), decodes them, and makes the
    /// underlying SDK call. Throwing signals the batch failed and the
    /// store will schedule a retry with exponential backoff; returning
    /// successfully causes the items to be dropped from the queue.
    public typealias Handler = @Sendable ([Data]) async throws -> Void

    /// Persistent item on the queue.
    private struct Item: Codable, Sendable {
        let id: UUID
        let kind: String
        let payload: Data
        let createdAt: Date
        var attempts: Int
        var nextRetryAt: Date
    }

    private struct RegisteredHandler: Sendable {
        let batchSize: Int
        let handler: Handler
    }

    // MARK: Config

    /// Smallest retry delay after a failed flush. Subsequent attempts
    /// double this up to `maxBackoff`.
    public let baseBackoff: TimeInterval
    /// Ceiling on the retry delay. Enough to ride out a short outage
    /// without hammering the server.
    public let maxBackoff: TimeInterval
    /// Stop trying after this many failed attempts — the item is
    /// dead-lettered (logged + dropped) so the queue can't fill up with
    /// a single bad payload the server will always reject.
    public let maxAttempts: Int
    /// Hard cap on the number of items we'll ever hold. Oldest are
    /// dropped on overflow; telemetry is lossy by design.
    public let maxQueueSize: Int

    // MARK: State

    private let storageURL: URL
    private let startNetworkMonitor: Bool
    private var items: [Item] = []
    private var handlers: [String: RegisteredHandler] = [:]
    private var loaded = false
    private var flushTask: Task<Void, Never>?
    private var networkMonitor: NWPathMonitor?
    private var isOnline: Bool = true
    private var deadLetterLog: (@Sendable (String, String, Int) -> Void)?

    // MARK: Init

    /// Create a store. Most consumers should use `DeferredStore.shared`;
    /// tests can create private instances with a custom storage URL and
    /// a deterministic clock by passing `enableNetworkMonitor: false`.
    ///
    /// - Parameters:
    ///   - storageURL: Where to persist the queue. Defaults to
    ///     `Application Support/donkey_deferred_queue.json`.
    ///   - baseBackoff: Initial retry delay after a failed flush.
    ///   - maxBackoff: Ceiling on the retry delay.
    ///   - maxAttempts: Number of tries before an item is dead-lettered.
    ///   - maxQueueSize: Hard cap on the number of pending items.
    ///   - enableNetworkMonitor: Whether to start an NWPathMonitor on
    ///     bootstrap. Tests can disable this to avoid leaking monitors.
    public init(
        storageURL: URL? = nil,
        baseBackoff: TimeInterval = 2,
        maxBackoff: TimeInterval = 300,
        maxAttempts: Int = 10,
        maxQueueSize: Int = 1000,
        enableNetworkMonitor: Bool = true
    ) {
        self.storageURL = storageURL ?? Self.defaultStorageURL()
        self.baseBackoff = baseBackoff
        self.maxBackoff = maxBackoff
        self.maxAttempts = maxAttempts
        self.maxQueueSize = maxQueueSize
        self.startNetworkMonitor = enableNetworkMonitor
    }

    // MARK: Public API

    /// Register a flush handler for a kind. Call this ONCE at app startup
    /// for every kind you plan to enqueue. Re-registration replaces the
    /// existing handler atomically.
    ///
    /// - Parameters:
    ///   - kind: Stable string identifier, e.g. `"engage.event"`. Must
    ///     match the `kind` passed to `enqueue`.
    ///   - batchSize: Max number of items per handler invocation. Set to
    ///     1 for operations that can't be batched (e.g. session reports);
    ///     higher for bulk-capable operations (e.g. 50 for analytics).
    ///   - handler: Receives `[Data]` of at most `batchSize` JSON-encoded
    ///     payloads. Throwing schedules a retry with exponential backoff.
    public func register(
        kind: String,
        batchSize: Int = 1,
        handler: @escaping Handler
    ) {
        handlers[kind] = RegisteredHandler(
            batchSize: max(1, batchSize),
            handler: handler
        )
    }

    /// Set a callback invoked when the store dead-letters (drops) an item
    /// because it exceeded `maxAttempts`. Consumers can wire this to
    /// their logging / diagnostics pipeline. Takes (kind, lastError, attempts).
    public func setDeadLetterLog(
        _ log: @escaping @Sendable (String, String, Int) -> Void
    ) {
        deadLetterLog = log
    }

    /// Enqueue a payload under a previously-registered kind.
    ///
    /// The payload is JSON-encoded, appended to the persistent queue,
    /// and a flush is scheduled. If no handler has been registered for
    /// the kind yet, the item is still persisted — it will be handled
    /// on the next flush after registration.
    ///
    /// Enqueue never throws: a serialization failure is logged locally
    /// and the item is dropped, because a payload that can't be encoded
    /// today won't encode tomorrow either and there's no point retrying.
    public func enqueue<Payload: Encodable & Sendable>(
        kind: String,
        payload: Payload
    ) {
        loadIfNeeded()
        let data: Data
        do {
            data = try JSONEncoder.iso.encode(payload)
        } catch {
            // Encoding failure is a programmer error, not transient.
            deadLetterLog?(kind, "encode_failed: \(error)", 0)
            return
        }
        let item = Item(
            id: UUID(),
            kind: kind,
            payload: data,
            createdAt: Date(),
            attempts: 0,
            nextRetryAt: Date()
        )
        items.append(item)
        // Drop oldest on overflow. Telemetry is lossy; newer items are
        // more actionable than stale ones.
        if items.count > maxQueueSize {
            items.removeFirst(items.count - maxQueueSize)
        }
        persist()
        scheduleFlush(delay: 0.5)
    }

    /// Load the persisted queue and start the network monitor if
    /// configured. Call this from your app's launch path and from the
    /// `.active` scene-phase handler so queue work resumes quickly on
    /// foreground transitions.
    public func bootstrap() {
        loadIfNeeded()
        startMonitorIfNeeded()
        scheduleFlush(delay: 0.1)
    }

    /// Force an immediate flush pass. Returns after the pass completes.
    /// Useful in tests and after known events that make a flush likely
    /// to succeed (e.g. user just signed in, a connectivity event fired).
    public func flushNow() async {
        await runFlushLoop(ignoringBackoff: false)
    }

    /// Drop every pending item without flushing. Called on user-initiated
    /// sign-out so queued events from the previous user don't leak into
    /// the next user's timeline.
    public func reset() {
        flushTask?.cancel()
        flushTask = nil
        items.removeAll()
        persist()
    }

    /// Current number of pending items. Primarily for diagnostics and tests.
    public var pendingCount: Int {
        loadIfNeeded()
        return items.count
    }

    // MARK: Flush loop

    private func scheduleFlush(delay: TimeInterval) {
        // Coalesce — if a flush is already scheduled or in flight, let
        // it pick up the newly-enqueued items on its current pass.
        if flushTask != nil { return }
        flushTask = Task { [weak self] in
            if delay > 0 {
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
            await self?.runFlushLoop(ignoringBackoff: false)
        }
    }

    private func runFlushLoop(ignoringBackoff: Bool) async {
        defer { flushTask = nil }

        // Bail fast if we're known to be offline — the NWPathMonitor
        // callback will re-kick us when connectivity returns.
        if !isOnline && !ignoringBackoff { return }

        loadIfNeeded()
        guard !items.isEmpty else { return }

        let now = Date()
        let readyIDs: Set<UUID>
        if ignoringBackoff {
            readyIDs = Set(items.map(\.id))
        } else {
            readyIDs = Set(items.filter { $0.nextRetryAt <= now }.map(\.id))
        }
        guard !readyIDs.isEmpty else { return }

        // Group ready items by kind so handlers can batch.
        let ready = items.filter { readyIDs.contains($0.id) }
        let grouped = Dictionary(grouping: ready, by: \.kind)

        for (kind, batch) in grouped {
            guard let registered = handlers[kind] else {
                // No handler yet — leave the items in place; they'll
                // flush once the handler registers. Don't bump attempts,
                // this isn't a failure.
                continue
            }
            for chunk in batch.chunks(of: registered.batchSize) {
                await flushChunk(kind: kind, chunk: chunk, handler: registered.handler)
            }
        }

        persist()
    }

    private func flushChunk(
        kind: String,
        chunk: [Item],
        handler: Handler
    ) async {
        let payloads = chunk.map(\.payload)
        do {
            try await handler(payloads)
            drop(chunk)
        } catch {
            handleFailure(chunk, error: error)
        }
    }

    // MARK: Success / failure bookkeeping

    private func drop(_ batch: [Item]) {
        let ids = Set(batch.map(\.id))
        items.removeAll { ids.contains($0.id) }
    }

    private func handleFailure(_ batch: [Item], error: Error) {
        let ids = Set(batch.map(\.id))
        var deadLetters: [(kind: String, error: String, attempts: Int)] = []

        for i in 0..<items.count {
            guard ids.contains(items[i].id) else { continue }
            items[i].attempts += 1

            if items[i].attempts >= maxAttempts {
                deadLetters.append((
                    kind: items[i].kind,
                    error: String(describing: error),
                    attempts: items[i].attempts
                ))
                continue
            }

            // Exponential: base, 2·base, 4·base, …, capped at maxBackoff.
            let delay = min(
                maxBackoff,
                baseBackoff * pow(2.0, Double(items[i].attempts - 1))
            )
            items[i].nextRetryAt = Date().addingTimeInterval(delay)
        }

        // Remove dead-lettered items and log them.
        items.removeAll { ids.contains($0.id) && $0.attempts >= maxAttempts }
        for dead in deadLetters {
            deadLetterLog?(dead.kind, dead.error, dead.attempts)
        }
    }

    // MARK: Persistence

    private func loadIfNeeded() {
        guard !loaded else { return }
        loaded = true
        guard let data = try? Data(contentsOf: storageURL),
              let decoded = try? JSONDecoder.iso.decode([Item].self, from: data)
        else { return }
        items = decoded
    }

    private func persist() {
        if let data = try? JSONEncoder.iso.encode(items) {
            try? data.write(to: storageURL, options: .atomic)
        }
    }

    private static func defaultStorageURL() -> URL {
        let appSupport = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0]
        // Application Support isn't created for us on iOS.
        try? FileManager.default.createDirectory(
            at: appSupport,
            withIntermediateDirectories: true
        )
        return appSupport.appendingPathComponent("donkey_deferred_queue.json")
    }

    // MARK: Network monitor

    private func startMonitorIfNeeded() {
        guard startNetworkMonitor, networkMonitor == nil else { return }
        let monitor = NWPathMonitor()
        self.networkMonitor = monitor
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { [weak self] in
                await self?.applyPath(online: online)
            }
        }
        monitor.start(queue: DispatchQueue(label: "donkey.deferred-store.net"))
    }

    private func applyPath(online: Bool) {
        let wasOffline = !isOnline
        isOnline = online
        if online && wasOffline {
            // Connectivity came back — kick the flush loop now rather
            // than waiting for the backoff timer on pending items.
            scheduleFlush(delay: 0)
        }
    }
}

// MARK: - Array chunking helper

private extension Array {
    func chunks(of size: Int) -> [[Element]] {
        guard size > 0 else { return [self] }
        return stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}

// MARK: - Shared ISO-8601 coders

private extension JSONEncoder {
    static let iso: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()
}

private extension JSONDecoder {
    static let iso: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}

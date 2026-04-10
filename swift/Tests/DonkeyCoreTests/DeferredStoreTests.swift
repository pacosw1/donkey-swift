import XCTest
@testable import DonkeyCore

/// Tests for the persistent, batching, backoff-aware `DeferredStore`.
///
/// Every test uses a per-test temporary file as the storage URL so the
/// suite can run in parallel without stepping on the process's shared
/// default store. `enableNetworkMonitor: false` is passed so tests don't
/// leak `NWPathMonitor` instances.
final class DeferredStoreTests: XCTestCase {

    // MARK: Helpers

    private func tempStorageURL() -> URL {
        let name = "deferred-store-\(UUID().uuidString).json"
        return FileManager.default.temporaryDirectory.appendingPathComponent(name)
    }

    private func makeStore(
        storageURL: URL? = nil,
        baseBackoff: TimeInterval = 0.05,
        maxBackoff: TimeInterval = 0.2,
        maxAttempts: Int = 3,
        maxQueueSize: Int = 100
    ) -> DeferredStore {
        DeferredStore(
            storageURL: storageURL ?? tempStorageURL(),
            baseBackoff: baseBackoff,
            maxBackoff: maxBackoff,
            maxAttempts: maxAttempts,
            maxQueueSize: maxQueueSize,
            enableNetworkMonitor: false
        )
    }

    private struct SamplePayload: Codable, Sendable, Equatable {
        let name: String
        let value: Int
    }

    // MARK: enqueue + flush happy path

    func testEnqueueAndFlushInvokesHandler() async throws {
        let store = makeStore()
        let received = PayloadRecorder<SamplePayload>()

        await store.register(kind: "sample", batchSize: 10) { dataItems in
            let decoded = dataItems.compactMap {
                try? JSONDecoder().decode(SamplePayload.self, from: $0)
            }
            await received.append(decoded)
        }

        await store.enqueue(kind: "sample", payload: SamplePayload(name: "a", value: 1))
        await store.enqueue(kind: "sample", payload: SamplePayload(name: "b", value: 2))
        await store.flushNow()

        let got = await received.all()
        XCTAssertEqual(got.count, 2)
        XCTAssertEqual(Set(got.map(\.name)), ["a", "b"])

        let pending = await store.pendingCount
        XCTAssertEqual(pending, 0, "successful batches should drain the queue")
    }

    // MARK: Batching

    func testHandlerReceivesUpToBatchSizePayloadsPerCall() async throws {
        let store = makeStore()
        let calls = BatchRecorder()

        await store.register(kind: "batch", batchSize: 3) { dataItems in
            await calls.record(dataItems.count)
        }

        for i in 0..<7 {
            await store.enqueue(kind: "batch", payload: SamplePayload(name: "n", value: i))
        }
        await store.flushNow()

        let sizes = await calls.sizes()
        XCTAssertEqual(sizes.sorted(by: >), [3, 3, 1], "7 items at batchSize 3 should split into 3+3+1")
    }

    // MARK: Backoff on failure

    func testFailingHandlerAppliesExponentialBackoff() async throws {
        let store = makeStore(baseBackoff: 0.05, maxBackoff: 1.0, maxAttempts: 5)
        let attemptCounter = AttemptCounter()

        await store.register(kind: "fail", batchSize: 1) { _ in
            await attemptCounter.increment()
            throw TestError.transient
        }

        await store.enqueue(kind: "fail", payload: SamplePayload(name: "x", value: 1))
        await store.flushNow()

        // First failure should leave the item in place with attempts=1.
        let pending1 = await store.pendingCount
        XCTAssertEqual(pending1, 1)

        // An immediate second flush should NOT retry — backoff not elapsed.
        await store.flushNow()
        let count1 = await attemptCounter.value
        XCTAssertEqual(count1, 1, "second immediate flush should respect backoff")

        // Wait past the first backoff window and retry.
        try await Task.sleep(nanoseconds: 120_000_000) // 120 ms
        await store.flushNow()
        let count2 = await attemptCounter.value
        XCTAssertEqual(count2, 2, "item should be retried after backoff elapsed")
    }

    // MARK: Dead-lettering

    func testItemIsDeadLetteredAfterMaxAttempts() async throws {
        let store = makeStore(baseBackoff: 0.01, maxBackoff: 0.05, maxAttempts: 3)
        let deadLetters = DeadLetterRecorder()
        await store.setDeadLetterLog { kind, error, attempts in
            Task { await deadLetters.record(kind: kind, error: error, attempts: attempts) }
        }
        await store.register(kind: "kill", batchSize: 1) { _ in
            throw TestError.permanent
        }
        await store.enqueue(kind: "kill", payload: SamplePayload(name: "y", value: 9))

        for _ in 0..<5 {
            await store.flushNow()
            try await Task.sleep(nanoseconds: 80_000_000) // 80 ms — past the max
        }

        let pending = await store.pendingCount
        XCTAssertEqual(pending, 0, "dead-lettered item should be dropped")

        // Give the dead-letter log Task a moment to run.
        try await Task.sleep(nanoseconds: 50_000_000)
        let record = await deadLetters.all()
        XCTAssertEqual(record.count, 1)
        XCTAssertEqual(record.first?.kind, "kill")
        XCTAssertEqual(record.first?.attempts, 3)
    }

    // MARK: Persistence across instances

    func testItemsSurviveStoreRecreation() async throws {
        let url = tempStorageURL()
        defer { try? FileManager.default.removeItem(at: url) }

        // First store: enqueue without flushing.
        do {
            let store = DeferredStore(
                storageURL: url,
                baseBackoff: 0.05,
                maxBackoff: 0.2,
                maxAttempts: 3,
                maxQueueSize: 100,
                enableNetworkMonitor: false
            )
            await store.enqueue(kind: "persist", payload: SamplePayload(name: "hello", value: 42))
            let pending = await store.pendingCount
            XCTAssertEqual(pending, 1)
        }

        // Second store (simulates app relaunch): load the same file,
        // register a handler, flush, expect the original item to go out.
        let store2 = DeferredStore(
            storageURL: url,
            baseBackoff: 0.05,
            maxBackoff: 0.2,
            maxAttempts: 3,
            maxQueueSize: 100,
            enableNetworkMonitor: false
        )
        let received = PayloadRecorder<SamplePayload>()
        await store2.register(kind: "persist", batchSize: 10) { dataItems in
            let decoded = dataItems.compactMap {
                try? JSONDecoder().decode(SamplePayload.self, from: $0)
            }
            await received.append(decoded)
        }
        await store2.flushNow()

        let got = await received.all()
        XCTAssertEqual(got, [SamplePayload(name: "hello", value: 42)])

        let pending2 = await store2.pendingCount
        XCTAssertEqual(pending2, 0)
    }

    // MARK: Overflow eviction

    func testMaxQueueSizeEvictsOldestItems() async throws {
        let store = makeStore(maxQueueSize: 3)
        for i in 0..<5 {
            await store.enqueue(kind: "x", payload: SamplePayload(name: "n", value: i))
        }
        let pending = await store.pendingCount
        XCTAssertEqual(pending, 3, "only the last 3 should survive")

        let received = PayloadRecorder<SamplePayload>()
        await store.register(kind: "x", batchSize: 10) { dataItems in
            let decoded = dataItems.compactMap {
                try? JSONDecoder().decode(SamplePayload.self, from: $0)
            }
            await received.append(decoded)
        }
        await store.flushNow()

        let got = await received.all()
        XCTAssertEqual(got.map(\.value).sorted(), [2, 3, 4], "oldest should be evicted first")
    }

    // MARK: Unregistered kind is parked, not lost

    func testItemsForUnregisteredKindAreKeptPending() async throws {
        let store = makeStore()
        await store.enqueue(kind: "later", payload: SamplePayload(name: "z", value: 7))
        // No handler yet — flush should be a no-op for this kind.
        await store.flushNow()
        let pending = await store.pendingCount
        XCTAssertEqual(pending, 1, "items for unregistered kinds stay in the queue")

        // Register the handler now; next flush drains.
        let received = PayloadRecorder<SamplePayload>()
        await store.register(kind: "later", batchSize: 1) { dataItems in
            let decoded = dataItems.compactMap {
                try? JSONDecoder().decode(SamplePayload.self, from: $0)
            }
            await received.append(decoded)
        }
        await store.flushNow()

        let got = await received.all()
        XCTAssertEqual(got, [SamplePayload(name: "z", value: 7)])
    }

    // MARK: Reset drops everything

    func testResetClearsPendingItems() async throws {
        let store = makeStore()
        await store.enqueue(kind: "drop", payload: SamplePayload(name: "a", value: 1))
        await store.enqueue(kind: "drop", payload: SamplePayload(name: "b", value: 2))
        await store.reset()
        let pending = await store.pendingCount
        XCTAssertEqual(pending, 0)
    }
}

// MARK: - Test helpers (actors to keep recorded state Sendable)

private actor PayloadRecorder<T: Sendable> {
    private var items: [T] = []
    func append(_ values: [T]) { items.append(contentsOf: values) }
    func all() -> [T] { items }
}

private actor BatchRecorder {
    private var batchSizes: [Int] = []
    func record(_ size: Int) { batchSizes.append(size) }
    func sizes() -> [Int] { batchSizes }
}

private actor AttemptCounter {
    private var count = 0
    func increment() { count += 1 }
    var value: Int { count }
}

private actor DeadLetterRecorder {
    struct Entry: Sendable {
        let kind: String
        let error: String
        let attempts: Int
    }
    private var entries: [Entry] = []
    func record(kind: String, error: String, attempts: Int) {
        entries.append(Entry(kind: kind, error: error, attempts: attempts))
    }
    func all() -> [Entry] { entries }
}

private enum TestError: Error {
    case transient
    case permanent
}

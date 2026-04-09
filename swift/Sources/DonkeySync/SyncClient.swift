import Foundation
import DonkeyCore

/// Client for the offline-first delta sync endpoints.
///
///   GET    /api/v1/sync/changes                    — pull server changes since `since`
///   POST   /api/v1/sync/batch                      — push client deltas
///   DELETE /api/v1/sync/:entityType/:entityId      — delete + tombstone an entity
///
/// The server's `getChanges` response is bespoke per app (each entity
/// handler declares its own shape), so this client decodes the pull side
/// into `AnyCodable` rather than a typed model. Call sites cast into
/// their own domain types as needed.
///
/// NOTE: the bible-app sync write route currently does NOT enforce App
/// Attest — see the comment in `sync-routes.ts`. Callers should not rely
/// on attested-only writes being available here today.
public struct SyncClient: Sendable {

    private let client: DonkeyClient
    private let basePath: String

    public init(client: DonkeyClient, basePath: String = "/api/v1") {
        self.client = client
        self.basePath = basePath
    }

    // MARK: Pull

    /// Fetch server-side changes since the given cursor. The cursor is an
    /// ISO-8601 timestamp string returned by the previous batch response
    /// (`syncedAt`). Pass nil on the very first sync to pull everything.
    public func getChanges(since: String? = nil, deviceId: String = "") async throws -> [String: AnyCodable] {
        var query: [String: String] = [:]
        if let since { query["since"] = since }
        if !deviceId.isEmpty { query["device_id"] = deviceId }
        let path = "\(basePath)/sync/changes" + encodeQuery(query)
        return try await client.request(path, method: .get)
    }

    // MARK: Push

    /// Push a batch of local deltas. `deviceId` scopes the server's
    /// notify-other-devices logic so the pushing client doesn't receive
    /// its own write back as a silent push.
    ///
    /// `idempotencyKey`, when set, is forwarded as the `Idempotency-Key`
    /// header — the server caches the response for 24h so retries are
    /// safe.
    public func pushBatch(
        items: [SyncBatchItem],
        deviceId: String = "",
        idempotencyKey: String? = nil
    ) async throws -> SyncBatchResponse {
        let body = BatchRequest(deviceId: deviceId, items: items)
        var extra: [String: String] = [:]
        if let idempotencyKey { extra["Idempotency-Key"] = idempotencyKey }
        return try await client.request(
            "\(basePath)/sync/batch",
            method: .post,
            body: body,
            extraHeaders: extra
        )
    }

    // MARK: Delete

    /// Delete an entity and record a tombstone so the server can replicate
    /// the deletion to other devices.
    @discardableResult
    public func deleteEntity(
        entityType: String,
        entityId: String,
        deviceId: String = ""
    ) async throws -> SyncStatusResponse {
        var query: [String: String] = [:]
        if !deviceId.isEmpty { query["device_id"] = deviceId }
        let path = "\(basePath)/sync/\(entityType)/\(entityId)" + encodeQuery(query)
        return try await client.request(path, method: .delete)
    }

    // MARK: Wire types

    private struct BatchRequest: Encodable, Sendable {
        let deviceId: String
        let items: [SyncBatchItem]

        private enum CodingKeys: String, CodingKey {
            case deviceId = "device_id"
            case items
        }
    }

    private func encodeQuery(_ params: [String: String]) -> String {
        guard !params.isEmpty else { return "" }
        var components = URLComponents()
        components.queryItems = params
            .sorted { $0.key < $1.key }
            .map { URLQueryItem(name: $0.key, value: $0.value) }
        return "?" + (components.percentEncodedQuery ?? "")
    }
}

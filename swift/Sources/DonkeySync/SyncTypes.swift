import Foundation
import DonkeyCore

/// Outbound sync batch item — mirrors `BatchItem` in `donkey-swift/sync`.
///
/// `fields` is an `AnyCodable` bag so any entity shape can round-trip
/// without the SDK modeling every field type. Callers build these from
/// their local GRDB models right before push.
public struct SyncBatchItem: Encodable, Sendable, Equatable {
    public let clientId: String
    public let entityType: String
    public let entityId: String?
    public let version: Int
    public let fields: [String: AnyCodable]

    private enum CodingKeys: String, CodingKey {
        case clientId   = "client_id"
        case entityType = "entity_type"
        case entityId   = "entity_id"
        case version
        case fields
    }

    public init(
        clientId: String,
        entityType: String,
        entityId: String? = nil,
        version: Int,
        fields: [String: AnyCodable]
    ) {
        self.clientId = clientId
        self.entityType = entityType
        self.entityId = entityId
        self.version = version
        self.fields = fields
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(clientId, forKey: .clientId)
        try c.encode(entityType, forKey: .entityType)
        try c.encodeIfPresent(entityId, forKey: .entityId)
        try c.encode(version, forKey: .version)
        try c.encode(fields, forKey: .fields)
    }
}

/// Successful upsert result for a single `SyncBatchItem` — mirrors
/// `BatchResponseItem` in `donkey-swift/sync`.
public struct SyncBatchResponseItem: Decodable, Sendable, Equatable {
    public let clientId: String
    public let serverId: String
    public let version: Int

    private enum CodingKeys: String, CodingKey {
        case clientId = "client_id"
        case serverId = "server_id"
        case version
    }

    public init(clientId: String, serverId: String, version: Int) {
        self.clientId = clientId
        self.serverId = serverId
        self.version = version
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.clientId = (try? c.decode(String.self, forKey: .clientId)) ?? ""
        self.serverId = (try? c.decode(String.self, forKey: .serverId)) ?? ""
        self.version  = (try? c.decode(Int.self, forKey: .version)) ?? 0
    }
}

/// Failed item in a batch response — mirrors `BatchError`.
public struct SyncBatchError: Decodable, Sendable, Equatable {
    public let clientId: String
    public let error: String
    public let isConflict: Bool
    public let serverVersion: Int?

    private enum CodingKeys: String, CodingKey {
        case clientId      = "client_id"
        case error
        case isConflict    = "is_conflict"
        case serverVersion = "server_version"
    }

    public init(clientId: String, error: String, isConflict: Bool = false, serverVersion: Int? = nil) {
        self.clientId = clientId
        self.error = error
        self.isConflict = isConflict
        self.serverVersion = serverVersion
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.clientId      = (try? c.decode(String.self, forKey: .clientId)) ?? ""
        self.error         = (try? c.decode(String.self, forKey: .error)) ?? "unknown"
        self.isConflict    = (try? c.decode(Bool.self, forKey: .isConflict)) ?? false
        self.serverVersion = try? c.decode(Int.self, forKey: .serverVersion)
    }
}

/// Response envelope for `POST /api/v1/sync/batch`.
public struct SyncBatchResponse: Decodable, Sendable, Equatable {
    public let items: [SyncBatchResponseItem]
    public let errors: [SyncBatchError]
    public let syncedAt: String

    private enum CodingKeys: String, CodingKey {
        case items
        case errors
        case syncedAt = "synced_at"
    }

    public init(items: [SyncBatchResponseItem], errors: [SyncBatchError], syncedAt: String) {
        self.items = items
        self.errors = errors
        self.syncedAt = syncedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.items    = (try? c.decode([SyncBatchResponseItem].self, forKey: .items)) ?? []
        self.errors   = (try? c.decode([SyncBatchError].self, forKey: .errors)) ?? []
        self.syncedAt = (try? c.decode(String.self, forKey: .syncedAt)) ?? ""
    }
}

/// Simple `{ "status": "ok" }` response used by the delete endpoint.
public struct SyncStatusResponse: Decodable, Sendable, Equatable {
    public let status: String

    public init(status: String) { self.status = status }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.status = (try? c.decode(String.self, forKey: .status)) ?? "ok"
    }

    private enum CodingKeys: String, CodingKey { case status }
}

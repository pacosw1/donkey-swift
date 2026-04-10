import Foundation
import DonkeyCore

/// A single analytics event reported to the donkey-swift engage package.
///
/// Mirrors the TS `EventInput` interface in `src/engage/index.ts`. The
/// `metadata` field is a JSON-serialized string on the wire — consumers
/// can either pass a pre-encoded string or use the helper initializer
/// that accepts an `Encodable` payload and handles encoding.
///
/// `Codable` (not just `Encodable`) so consumers can round-trip events
/// through `DonkeyCore.DeferredStore` for persistent offline queueing —
/// the store serializes the payload on enqueue and decodes it back on
/// flush, and that requires `Decodable` on the value type.
public struct EngageEvent: Codable, Sendable, Equatable {
    public let event: String
    public let metadata: String
    public let timestamp: String

    public init(event: String, metadata: String = "{}", timestamp: Date = Date()) {
        self.event = event
        self.metadata = metadata
        self.timestamp = ISO8601DateFormatter().string(from: timestamp)
    }

    /// Convenience initializer that JSON-encodes a strongly-typed metadata
    /// payload. Falls back to "{}" if encoding fails (matching the TS
    /// server's lenient metadata handling).
    public init<Metadata: Encodable>(
        event: String,
        metadata: Metadata,
        timestamp: Date = Date()
    ) {
        self.event = event
        let encoder = JSONEncoder()
        if let data = try? encoder.encode(metadata),
           let json = String(data: data, encoding: .utf8) {
            self.metadata = json
        } else {
            self.metadata = "{}"
        }
        self.timestamp = ISO8601DateFormatter().string(from: timestamp)
    }
}

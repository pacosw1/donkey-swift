import Foundation
import DonkeyCore

/// Client for the GDPR-oriented account routes.
///
///   GET  /api/v1/account/export  — authed, returns a `UserDataExport`
///   POST /api/v1/account/delete  — authed, empty body, returns `{ status }`
///
/// The server persists nothing else here — the heavy lifting lives in the
/// `donkey-swift/account` TS package.
public struct AccountClient: Sendable {

    private let client: DonkeyClient
    private let basePath: String

    public init(client: DonkeyClient, basePath: String = "/api/v1") {
        self.client = client
        self.basePath = basePath
    }

    // MARK: Export

    /// Download the full GDPR export for the current user. The server
    /// returns a JSON object whose keys match the `UserDataExport` shape
    /// from the TS package — the payload is held as an `AnyCodable` bag so
    /// consumers can pretty-print or archive it without every field having
    /// a typed model.
    public func exportData() async throws -> UserDataExport {
        try await client.request(
            "\(basePath)/account/export",
            method: .get
        )
    }

    // MARK: Delete

    /// Delete the current user's account. The server deletes app data,
    /// anonymizes what it must retain, and revokes the identity provider
    /// link — after this call the bearer token becomes invalid and the
    /// client should redirect to sign-in.
    @discardableResult
    public func deleteAccount() async throws -> AccountStatusResponse {
        try await client.request(
            "\(basePath)/account/delete",
            method: .post
        )
    }
}

/// GDPR export envelope. The server sends a loose JSON map because each
/// bundled app (bible-app, water, …) adds its own `app_data` shape on top
/// of the baseline `user` / `subscription` / `events` fields. `AnyCodable`
/// keeps all of it decodeable without forcing the SDK to know every shape.
public struct UserDataExport: Decodable, Sendable, Equatable {
    public let user: AnyCodable?
    public let subscription: AnyCodable?
    public let events: AnyCodable?
    public let sessions: AnyCodable?
    public let feedback: AnyCodable?
    public let chatMessages: AnyCodable?
    public let deviceTokens: AnyCodable?
    public let notificationPreferences: AnyCodable?
    public let transactions: AnyCodable?
    public let appData: AnyCodable?

    private enum CodingKeys: String, CodingKey {
        case user
        case subscription
        case events
        case sessions
        case feedback
        case chatMessages            = "chat_messages"
        case deviceTokens            = "device_tokens"
        case notificationPreferences = "notification_preferences"
        case transactions
        case appData                 = "app_data"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.user                    = try? c.decode(AnyCodable.self, forKey: .user)
        self.subscription            = try? c.decode(AnyCodable.self, forKey: .subscription)
        self.events                  = try? c.decode(AnyCodable.self, forKey: .events)
        self.sessions                = try? c.decode(AnyCodable.self, forKey: .sessions)
        self.feedback                = try? c.decode(AnyCodable.self, forKey: .feedback)
        self.chatMessages            = try? c.decode(AnyCodable.self, forKey: .chatMessages)
        self.deviceTokens            = try? c.decode(AnyCodable.self, forKey: .deviceTokens)
        self.notificationPreferences = try? c.decode(AnyCodable.self, forKey: .notificationPreferences)
        self.transactions            = try? c.decode(AnyCodable.self, forKey: .transactions)
        self.appData                 = try? c.decode(AnyCodable.self, forKey: .appData)
    }
}

/// Simple `{ "status": "ok" }` envelope used by `/account/delete`.
public struct AccountStatusResponse: Decodable, Sendable, Equatable {
    public let status: String

    public init(status: String) { self.status = status }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.status = (try? c.decode(String.self, forKey: .status)) ?? "ok"
    }

    private enum CodingKeys: String, CodingKey { case status }
}

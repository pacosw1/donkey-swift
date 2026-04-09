import Foundation
import DonkeyCore

/// Client for the donkey-swift `engage` package.
///
/// Wraps the common engagement endpoints the app uses to feed the
/// analytics pipeline and pull personalization decisions:
///
///   POST /api/v1/events       — batch-report events
///   GET  /api/v1/eligibility  — current paywall / pro / engagement state
///   POST /api/v1/feedback     — user-submitted feedback
///   POST /api/v1/session      — session start/end report
///   PUT  /api/v1/subscription — write subscription state from StoreKit
///
/// The client is a value type; share one per app, initialized once with
/// a `DonkeyClient` that carries the session token and base URL.
public struct EngageClient: Sendable {

    private let client: DonkeyClient
    private let basePath: String

    public init(client: DonkeyClient, basePath: String = "/api/v1") {
        self.client = client
        self.basePath = basePath
    }

    // MARK: Events

    /// Batch-report analytics events. Returns the count the server
    /// persisted (may be less than the input on validation rejection).
    @discardableResult
    public func trackEvents(_ events: [EngageEvent]) async throws -> Int {
        let body = TrackEventsRequest(events: events)
        let response: TrackEventsResponse = try await client.request(
            "\(basePath)/events",
            method: .post,
            body: body
        )
        return response.tracked
    }

    /// Fire-and-forget convenience for a single event. Swallows errors
    /// — analytics reporting failures should never block the UI.
    public func track(
        _ eventName: String,
        metadata: String = "{}"
    ) async {
        let event = EngageEvent(event: eventName, metadata: metadata)
        do {
            _ = try await trackEvents([event])
        } catch {
            // Intentional: analytics failures must not surface to the caller.
        }
    }

    // MARK: Eligibility

    /// Get the user's current paywall eligibility + engagement snapshot.
    /// Safe to call on every app launch — the server computes this
    /// cheaply from cached engagement data.
    public func getEligibility() async throws -> EligibilityResult {
        try await client.request("\(basePath)/eligibility", method: .get)
    }

    // MARK: Feedback

    /// Submit user feedback (bug report, feature request, etc.).
    public func submitFeedback(
        type: String = "general",
        message: String,
        appVersion: String? = nil
    ) async throws {
        let body = FeedbackRequest(type: type, message: message, appVersion: appVersion)
        try await client.requestVoid(
            "\(basePath)/feedback",
            method: .post,
            body: body
        )
    }

    // MARK: Session reporting

    /// Report the start or end of a user session. Call once on foreground
    /// transition (action: .start) and again on background (.end) with
    /// the elapsed seconds.
    public enum SessionAction: String, Encodable, Sendable {
        case start
        case end
    }

    public func reportSession(
        sessionId: String,
        action: SessionAction,
        appVersion: String? = nil,
        osVersion: String? = nil,
        country: String? = nil,
        durationSeconds: Int? = nil
    ) async throws {
        let body = SessionRequest(
            sessionId: sessionId,
            action: action,
            appVersion: appVersion,
            osVersion: osVersion,
            country: country,
            durationSeconds: durationSeconds
        )
        try await client.requestVoid(
            "\(basePath)/session",
            method: .post,
            body: body
        )
    }

    // MARK: Subscription state

    /// Push the latest subscription state from StoreKit up to the server.
    /// The server uses this to drive paywall gating and pro-only features
    /// — receipt verification still happens server-side via the receipt
    /// package, this is the lightweight state sync.
    public func updateSubscription(
        productId: String,
        status: String,
        expiresAt: Date? = nil,
        originalTransactionId: String? = nil,
        priceCents: Int? = nil,
        currencyCode: String? = nil
    ) async throws {
        let body = SubscriptionRequest(
            productId: productId,
            status: status,
            expiresAt: expiresAt,
            originalTransactionId: originalTransactionId,
            priceCents: priceCents,
            currencyCode: currencyCode
        )
        try await client.requestVoid(
            "\(basePath)/subscription",
            method: .put,
            body: body
        )
    }

    // MARK: Wire types

    private struct TrackEventsRequest: Encodable, Sendable {
        let events: [EngageEvent]
    }

    private struct TrackEventsResponse: Decodable, Sendable {
        let tracked: Int
    }

    private struct FeedbackRequest: Encodable, Sendable {
        let type: String
        let message: String
        let appVersion: String?

        enum CodingKeys: String, CodingKey {
            case type
            case message
            case appVersion = "app_version"
        }
    }

    private struct SessionRequest: Encodable, Sendable {
        let sessionId: String
        let action: SessionAction
        let appVersion: String?
        let osVersion: String?
        let country: String?
        let durationSeconds: Int?

        enum CodingKeys: String, CodingKey {
            case sessionId       = "session_id"
            case action
            case appVersion      = "app_version"
            case osVersion       = "os_version"
            case country
            case durationSeconds = "duration_s"
        }
    }

    private struct SubscriptionRequest: Encodable, Sendable {
        let productId: String
        let status: String
        let expiresAt: Date?
        let originalTransactionId: String?
        let priceCents: Int?
        let currencyCode: String?

        enum CodingKeys: String, CodingKey {
            case productId             = "product_id"
            case status
            case expiresAt             = "expires_at"
            case originalTransactionId = "original_transaction_id"
            case priceCents            = "price_cents"
            case currencyCode          = "currency_code"
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(productId, forKey: .productId)
            try c.encode(status, forKey: .status)
            if let expiresAt {
                try c.encode(ISO8601DateFormatter().string(from: expiresAt), forKey: .expiresAt)
            }
            try c.encodeIfPresent(originalTransactionId, forKey: .originalTransactionId)
            try c.encodeIfPresent(priceCents, forKey: .priceCents)
            try c.encodeIfPresent(currencyCode, forKey: .currencyCode)
        }
    }
}

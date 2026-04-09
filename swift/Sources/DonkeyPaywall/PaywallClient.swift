import Foundation
import DonkeyCore

/// Client for the server-driven paywall config + dismissal flow.
///
///   GET  /api/v1/paywall           — authed, returns `PaywallPayload`
///   POST /api/v1/paywall/dismiss   — authed, empty body
///
/// Usage:
///
///     let paywall = PaywallClient(client: donkey)
///     let payload = try await paywall.getPaywall(locale: "en")
///     view.render(payload.config)
///
/// The iOS consumer is expected to pass the current UI locale so the server
/// can fall back to the best-matching stored translation. The backend accepts
/// both the `locale` query string and the `x-sacred-language` header — this
/// client uses the query string so callers don't need to reach into header
/// plumbing.
public struct PaywallClient: Sendable {

    private let client: DonkeyClient
    private let basePath: String

    public init(client: DonkeyClient, basePath: String = "/api/v1") {
        self.client = client
        self.basePath = basePath
    }

    /// Fetch the paywall configuration for the current user.
    ///
    /// - Parameters:
    ///   - locale: BCP-47 locale string (e.g. "en", "es-MX"). Defaults to nil
    ///     which lets the server decide.
    ///   - stage: Optional build-stage override. If nil, the server reads
    ///     `X-App-Stage` from the request headers (already set by DonkeyCore).
    ///   - daysSinceActive: Optional engagement hint used by the server to
    ///     pick the right conversion offer variant.
    public func getPaywall(
        locale: String? = nil,
        stage: String? = nil,
        daysSinceActive: Int? = nil
    ) async throws -> PaywallPayload {
        var query: [String: String] = [:]
        if let locale { query["locale"] = locale }
        if let stage { query["stage"] = stage }
        if let daysSinceActive { query["days_since_active"] = String(daysSinceActive) }

        let path = "\(basePath)/paywall" + encodeQuery(query)
        return try await client.request(path, method: .get)
    }

    /// Record that the user dismissed the paywall. Called after the user
    /// closes the paywall sheet without subscribing — the server uses this
    /// to drive the conversion-offer cooldown logic.
    public func dismissPaywall() async throws {
        try await client.requestVoid(
            "\(basePath)/paywall/dismiss",
            method: .post
        )
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

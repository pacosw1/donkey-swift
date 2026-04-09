import Foundation
import DonkeyCore

/// Client for the donkey-swift `flags` package.
///
/// Wraps a `DonkeyClient` and exposes typed methods that hit the backend's
/// flag evaluation routes:
///
///   POST /api/v1/flags/evaluate   — body `{ keys, context }`
///
/// Usage in an iOS feature flag store:
///
///     let donkey = DonkeyClient(
///         baseURL: URL(string: "https://api.sacredscrolls.app")!,
///         tokenProvider: { await AuthStore.shared.currentToken }
///     )
///     let flags = FlagsClient(client: donkey)
///
///     let ctx = FlagContext(
///         userId: session.userId,
///         appVersion: Bundle.main.shortVersionString,
///         platform: .ios,
///         locale: Locale.current.identifier,
///         country: Locale.current.region?.identifier,
///         isPro: subscriptions.isPro
///     )
///
///     let results = try await flags.evaluate(keys: ["home_verse_of_the_day"], context: ctx)
///     let on = results["home_verse_of_the_day"]?.isEnabled ?? false
public struct FlagsClient: Sendable {

    private let client: DonkeyClient
    private let basePath: String

    /// - Parameters:
    ///   - client: Shared `DonkeyClient` that owns transport + auth.
    ///   - basePath: Route prefix. Defaults to `/api/v1` to match the
    ///     donkey-swift Hono starter and bible-app's current wiring.
    public init(client: DonkeyClient, basePath: String = "/api/v1") {
        self.client = client
        self.basePath = basePath
    }

    // MARK: Evaluate

    /// Evaluate a batch of flags against a context. The returned dictionary
    /// is keyed by flag key and contains the full `FlagEvaluation` including
    /// the served value, which rule fired, and (for A/B tests) the variant
    /// the user landed in.
    ///
    /// If `keys` is empty, the backend evaluates every flag it knows about.
    public func evaluate(
        keys: [String] = [],
        context: FlagContext
    ) async throws -> [String: FlagEvaluation] {
        let body = EvaluateRequest(keys: keys.isEmpty ? nil : keys, context: context)
        let response: EvaluateResponse = try await client.request(
            "\(basePath)/flags/evaluate",
            method: .post,
            body: body
        )
        return response.flags
    }

    /// Convenience: evaluate a single boolean flag. Returns `defaultValue`
    /// on any failure (network, decoding, missing flag) so callers can use
    /// this without wrapping in try/catch when they just want a fallback.
    public func evaluateBool(
        _ key: String,
        context: FlagContext,
        default defaultValue: Bool = false
    ) async -> Bool {
        do {
            let results = try await evaluate(keys: [key], context: context)
            return results[key]?.isEnabled ?? defaultValue
        } catch {
            return defaultValue
        }
    }

    // MARK: Wire types

    private struct EvaluateRequest: Encodable, Sendable {
        let keys: [String]?
        let context: FlagContext
    }

    private struct EvaluateResponse: Decodable, Sendable {
        let flags: [String: FlagEvaluation]
    }
}

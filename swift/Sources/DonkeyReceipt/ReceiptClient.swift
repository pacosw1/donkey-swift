import Foundation
import DonkeyCore

/// Client for StoreKit 2 receipt verification.
///
///   POST /api/v1/receipt/verify  — authed, body `{ "transactionJWS": "<jws>" }`
///
/// The App Store Server Notifications webhook lives at
/// `/api/v1/receipt/webhook` on the backend but is server-only — the iOS
/// app never calls it, so the SDK does not expose it.
///
/// Usage:
///
///     for try await result in Transaction.updates {
///         guard case .verified(let transaction) = result else { continue }
///         _ = try await ReceiptClient(client: donkey).verify(
///             transactionJWS: result.jwsRepresentation
///         )
///         await transaction.finish()
///     }
public struct ReceiptClient: Sendable {

    private let client: DonkeyClient
    private let basePath: String

    public init(client: DonkeyClient, basePath: String = "/api/v1") {
        self.client = client
        self.basePath = basePath
    }

    /// Verify a StoreKit 2 signed transaction JWS against the backend. The
    /// server validates the chain-of-trust, updates the subscription row,
    /// and returns the canonical status.
    @discardableResult
    public func verify(transactionJWS: String) async throws -> ReceiptVerifyResponse {
        let body = VerifyRequest(transactionJWS: transactionJWS)
        return try await client.request(
            "\(basePath)/receipt/verify",
            method: .post,
            body: body
        )
    }

    // MARK: Wire types

    // NOTE: the server reads this field as `transactionJWS` (camelCase) in
    // `handlers/support-routes.ts` — see the `const { transactionJWS } =
    // await ctx.req.json()` line. This is one of the rare camelCase keys in
    // the bible-app API surface, so it's intentional and should NOT be
    // changed to snake_case here.
    private struct VerifyRequest: Encodable, Sendable {
        let transactionJWS: String
    }
}

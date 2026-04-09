import Foundation
import DonkeyCore

/// Client for StoreKit 2 receipt verification.
///
///   POST /api/v1/receipts/verify  — authed, body `{ "transaction_jws": "<jws>" }`
///
/// The App Store Server Notifications webhook lives at
/// `/api/v1/receipts/webhook` on the backend but is server-only — the iOS
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
        let body = VerifyRequest(transactionJws: transactionJWS)
        return try await client.request(
            "\(basePath)/receipts/verify",
            method: .post,
            body: body
        )
    }

    // MARK: Wire types

    /// Body for `POST /receipts/verify`. The server's canonical body key is
    /// `transaction_jws` (snake_case, matching the rest of the API surface).
    /// The old `transactionJWS` camelCase key is still accepted by the
    /// backend as a transitional alias, but new clients should use snake_case.
    private struct VerifyRequest: Encodable, Sendable {
        let transactionJws: String

        enum CodingKeys: String, CodingKey {
            case transactionJws = "transaction_jws"
        }
    }
}

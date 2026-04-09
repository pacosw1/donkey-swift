import Foundation

/// Response body for `POST /api/v1/receipt/verify`.
///
/// Matches the `VerifyResponse` shape in the `donkey-swift/receipt` package.
/// Fields use snake_case on the wire; Swift exposes them camelCase.
///
/// `expiresAt` is optional because non-subscription products (consumables,
/// non-renewing) never populate it. `status` maps to one of the
/// `SubscriptionStatus` values in the TS package — kept as a plain string
/// here so new statuses don't require an SDK bump.
public struct ReceiptVerifyResponse: Decodable, Sendable, Equatable {
    public let verified: Bool
    public let status: String
    public let productId: String
    public let transactionId: String
    public let expiresAt: Date?

    private enum CodingKeys: String, CodingKey {
        case verified
        case status
        case productId     = "product_id"
        case transactionId = "transaction_id"
        case expiresAt     = "expires_at"
    }

    public init(
        verified: Bool,
        status: String,
        productId: String,
        transactionId: String,
        expiresAt: Date?
    ) {
        self.verified = verified
        self.status = status
        self.productId = productId
        self.transactionId = transactionId
        self.expiresAt = expiresAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.verified      = (try? c.decode(Bool.self, forKey: .verified)) ?? false
        self.status        = (try? c.decode(String.self, forKey: .status)) ?? "unknown"
        self.productId     = (try? c.decode(String.self, forKey: .productId)) ?? ""
        self.transactionId = (try? c.decode(String.self, forKey: .transactionId)) ?? ""
        self.expiresAt     = try? c.decode(Date.self, forKey: .expiresAt)
    }
}

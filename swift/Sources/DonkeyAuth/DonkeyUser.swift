import Foundation

/// A donkey-swift authenticated user.
///
/// Mirrors the `User` type in `src/auth/index.ts` with the app-specific
/// `role` enrichment that bible-app's auth-routes handler tacks on before
/// returning the payload. Consumers that don't populate a role column can
/// ignore the field — it decodes to `"user"` when missing.
public struct DonkeyUser: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let appleSub: String
    public let email: String
    public let name: String
    public let role: String
    public let createdAt: Date?
    public let lastLoginAt: Date?

    private enum CodingKeys: String, CodingKey {
        case id
        case appleSub = "apple_sub"
        case email
        case name
        case role
        case createdAt = "created_at"
        case lastLoginAt = "last_login_at"
    }

    public init(
        id: String,
        appleSub: String,
        email: String,
        name: String,
        role: String = "user",
        createdAt: Date? = nil,
        lastLoginAt: Date? = nil
    ) {
        self.id = id
        self.appleSub = appleSub
        self.email = email
        self.name = name
        self.role = role
        self.createdAt = createdAt
        self.lastLoginAt = lastLoginAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id       = try c.decode(String.self, forKey: .id)
        self.appleSub = (try? c.decode(String.self, forKey: .appleSub)) ?? ""
        self.email    = (try? c.decode(String.self, forKey: .email)) ?? ""
        self.name     = (try? c.decode(String.self, forKey: .name)) ?? ""
        self.role     = (try? c.decode(String.self, forKey: .role)) ?? "user"
        self.createdAt   = try? c.decode(Date.self, forKey: .createdAt)
        self.lastLoginAt = try? c.decode(Date.self, forKey: .lastLoginAt)
    }
}

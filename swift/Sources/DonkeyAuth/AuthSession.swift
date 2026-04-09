import Foundation

/// A successful authentication response from any of the auth endpoints
/// (`POST /api/v1/auth/apple`, `POST /api/v1/auth/refresh`).
///
/// The `refreshToken` is optional because the bible-app server only
/// populates it when the Apple authorization code exchange is enabled
/// (i.e. there's a Sign In with Apple private key on disk). Clients
/// should treat a nil `refreshToken` as "stateless JWT only — no
/// refresh possible until the user re-signs-in".
public struct AuthSession: Codable, Sendable, Equatable {
    public let token: String
    public let refreshToken: String?
    public let user: DonkeyUser

    private enum CodingKeys: String, CodingKey {
        case token
        case refreshToken = "refreshToken"
        case user
    }

    public init(token: String, refreshToken: String?, user: DonkeyUser) {
        self.token = token
        self.refreshToken = refreshToken
        self.user = user
    }
}

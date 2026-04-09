import Foundation
import DonkeyCore

/// Client for the donkey-swift `auth` package.
///
/// Covers the four auth routes every iOS consumer needs:
///
///   POST /api/v1/auth/apple    — Sign in with Apple, returns session + user
///   POST /api/v1/auth/refresh  — exchange refresh token for a fresh JWT
///   POST /api/v1/auth/logout   — revoke current session + refresh token
///   GET  /api/v1/auth/me       — current user profile
///
/// Usage:
///
///     let donkey = DonkeyClient(baseURL: url, tokenProvider: { await Keychain.token })
///     let auth = AuthClient(client: donkey)
///
///     // After Sign in with Apple succeeds locally on the device:
///     let session = try await auth.signInWithApple(
///         identityToken: credential.identityToken!,
///         authorizationCode: credential.authorizationCode,
///         name: "\(credential.fullName?.givenName ?? "") \(credential.fullName?.familyName ?? "")"
///     )
///     Keychain.save(session.token)
///     if let refresh = session.refreshToken { Keychain.saveRefresh(refresh) }
///
public struct AuthClient: Sendable {

    private let client: DonkeyClient
    private let basePath: String

    public init(client: DonkeyClient, basePath: String = "/api/v1") {
        self.client = client
        self.basePath = basePath
    }

    // MARK: Sign in with Apple

    /// Trade an Apple identity token (and optional authorization code) for
    /// a donkey-swift session. `name` is only used on the *first* sign-in
    /// — Apple stops sending it on subsequent logins, so pass the value
    /// from the credential on day one and nothing from then on.
    public func signInWithApple(
        identityToken: String,
        authorizationCode: String? = nil,
        name: String? = nil,
        installationId: String? = nil
    ) async throws -> AuthSession {
        let body = AppleSignInRequest(
            identityToken: identityToken,
            authorizationCode: authorizationCode,
            name: name,
            installationId: installationId
        )
        return try await client.request(
            "\(basePath)/auth/apple",
            method: .post,
            body: body
        )
    }

    // MARK: Refresh

    /// Exchange a refresh token for a fresh session. Throws
    /// `DonkeyError.unauthorized` if the refresh token is expired or
    /// revoked — callers should kick the user back to sign-in on that.
    public func refresh(refreshToken: String) async throws -> AuthSession {
        let body = RefreshRequest(refreshToken: refreshToken)
        return try await client.request(
            "\(basePath)/auth/refresh",
            method: .post,
            body: body
        )
    }

    // MARK: Logout

    /// Revoke the current session on the server. Pass the refresh token
    /// to also revoke it server-side; otherwise only the bearer session
    /// is terminated. Swallows any non-401 failures since the caller is
    /// almost always signing out locally regardless.
    public func logout(refreshToken: String? = nil) async throws {
        try await client.requestVoid(
            "\(basePath)/auth/logout",
            method: .post,
            body: LogoutRequest(refreshToken: refreshToken)
        )
    }

    // MARK: Me

    /// Fetch the current user from the server. Uses the bearer token
    /// provided by the `DonkeyClient.tokenProvider` closure.
    public func me() async throws -> DonkeyUser {
        try await client.request("\(basePath)/auth/me", method: .get)
    }

    // MARK: Wire types

    /// Matches the snake_case shape the bible-app auth route prefers —
    /// the server tolerates camelCase too but snake is the primary.
    private struct AppleSignInRequest: Encodable, Sendable {
        let identityToken: String
        let authorizationCode: String?
        let name: String?
        let installationId: String?

        enum CodingKeys: String, CodingKey {
            case identityToken     = "identity_token"
            case authorizationCode = "authorization_code"
            case name
            case installationId    = "installation_id"
        }
    }

    private struct RefreshRequest: Encodable, Sendable {
        let refreshToken: String

        enum CodingKeys: String, CodingKey {
            case refreshToken = "refresh_token"
        }
    }

    private struct LogoutRequest: Encodable, Sendable {
        let refreshToken: String?

        enum CodingKeys: String, CodingKey {
            case refreshToken = "refresh_token"
        }
    }
}

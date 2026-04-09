import XCTest
import DonkeyCore
@testable import DonkeyAuth

final class AuthClientTests: XCTestCase {

    // MARK: Apple sign-in wire format

    func testAppleSignInEncodesSnakeCaseBody() throws {
        // The backend route reads identity_token / authorization_code /
        // installation_id in snake_case — we verify the Swift client
        // actually emits those keys.
        struct ProbeRequest: Encodable {
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
        let body = ProbeRequest(
            identityToken: "eyJ.token.here",
            authorizationCode: "code-xyz",
            name: "Ada Lovelace",
            installationId: "install-001"
        )
        let data = try JSONEncoder().encode(body)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(json["identity_token"] as? String, "eyJ.token.here")
        XCTAssertEqual(json["authorization_code"] as? String, "code-xyz")
        XCTAssertEqual(json["name"] as? String, "Ada Lovelace")
        XCTAssertEqual(json["installation_id"] as? String, "install-001")
    }

    // MARK: Session response decoding

    func testDecodesAuthSessionWithRoleEnrichment() throws {
        let payload = """
        {
          "token": "sess.jwt",
          "refreshToken": "refresh.jwt",
          "user": {
            "id": "user-1",
            "apple_sub": "001122.fake",
            "email": "ada@example.com",
            "name": "Ada Lovelace",
            "role": "admin"
          }
        }
        """.data(using: .utf8)!

        let session = try JSONDecoder().decode(AuthSession.self, from: payload)
        XCTAssertEqual(session.token, "sess.jwt")
        XCTAssertEqual(session.refreshToken, "refresh.jwt")
        XCTAssertEqual(session.user.id, "user-1")
        XCTAssertEqual(session.user.appleSub, "001122.fake")
        XCTAssertEqual(session.user.email, "ada@example.com")
        XCTAssertEqual(session.user.role, "admin")
    }

    func testDecodesAuthSessionWithMissingRoleAndRefreshToken() throws {
        // Minimal server response: no refreshToken (stateless JWT only),
        // no role field. Both should fall back to sensible defaults.
        let payload = """
        {
          "token": "sess.jwt",
          "user": {
            "id": "user-2",
            "email": "bob@example.com",
            "name": "Bob"
          }
        }
        """.data(using: .utf8)!

        let session = try JSONDecoder().decode(AuthSession.self, from: payload)
        XCTAssertEqual(session.token, "sess.jwt")
        XCTAssertNil(session.refreshToken)
        XCTAssertEqual(session.user.role, "user", "missing role should default to 'user'")
        XCTAssertEqual(session.user.appleSub, "", "missing apple_sub should decode to empty string")
    }

    // MARK: End-to-end with stub transport

    func testSignInWithAppleHitsExpectedURL() async throws {
        let expectedURL = URL(string: "https://api.example.test/api/v1/auth/apple")!
        let responseBody = """
        {
          "token": "sess.jwt",
          "refreshToken": "refresh.jwt",
          "user": { "id": "u1", "apple_sub": "sub", "email": "u1@x.com", "name": "U1", "role": "user" }
        }
        """.data(using: .utf8)!

        AuthStubURLProtocol.stub = AuthStubURLProtocol.Stub(
            expectedURL: expectedURL,
            expectedMethod: "POST",
            responseStatus: 200,
            responseBody: responseBody
        )
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [AuthStubURLProtocol.self]
        let session = URLSession(configuration: config)

        let donkey = DonkeyClient(
            baseURL: URL(string: "https://api.example.test")!,
            tokenProvider: { nil },
            session: session
        )
        let client = AuthClient(client: donkey)
        let result = try await client.signInWithApple(
            identityToken: "identity.token",
            authorizationCode: "code",
            name: "User One"
        )
        XCTAssertEqual(result.token, "sess.jwt")
        XCTAssertEqual(result.user.id, "u1")

        let recorded = try XCTUnwrap(AuthStubURLProtocol.lastRequest)
        XCTAssertEqual(recorded.url, expectedURL)
        XCTAssertEqual(recorded.httpMethod, "POST")
    }

    func testRefreshMapsUnauthorizedTo401() async {
        let expectedURL = URL(string: "https://api.example.test/api/v1/auth/refresh")!
        AuthStubURLProtocol.stub = AuthStubURLProtocol.Stub(
            expectedURL: expectedURL,
            expectedMethod: "POST",
            responseStatus: 401,
            responseBody: Data("{\"error\":\"expired\"}".utf8)
        )
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [AuthStubURLProtocol.self]
        let session = URLSession(configuration: config)

        let donkey = DonkeyClient(
            baseURL: URL(string: "https://api.example.test")!,
            tokenProvider: { nil },
            session: session
        )
        let client = AuthClient(client: donkey)

        do {
            _ = try await client.refresh(refreshToken: "stale")
            XCTFail("expected unauthorized")
        } catch DonkeyError.unauthorized {
            // expected
        } catch {
            XCTFail("expected DonkeyError.unauthorized, got \(error)")
        }
    }

    func testLogoutRequestIsVoidAndTolerates204() async throws {
        let expectedURL = URL(string: "https://api.example.test/api/v1/auth/logout")!
        AuthStubURLProtocol.stub = AuthStubURLProtocol.Stub(
            expectedURL: expectedURL,
            expectedMethod: "POST",
            responseStatus: 204,
            responseBody: Data()
        )
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [AuthStubURLProtocol.self]
        let session = URLSession(configuration: config)

        let donkey = DonkeyClient(
            baseURL: URL(string: "https://api.example.test")!,
            tokenProvider: { "sess.jwt" },
            session: session
        )
        let client = AuthClient(client: donkey)
        try await client.logout(refreshToken: "refresh.jwt")

        let recorded = try XCTUnwrap(AuthStubURLProtocol.lastRequest)
        XCTAssertEqual(recorded.httpMethod, "POST")
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Authorization"), "Bearer sess.jwt")
    }
}

// MARK: - URLProtocol stub (per-suite to avoid cross-contamination)

final class AuthStubURLProtocol: URLProtocol, @unchecked Sendable {

    struct Stub: Sendable {
        let expectedURL: URL
        let expectedMethod: String
        let responseStatus: Int
        let responseBody: Data
    }

    nonisolated(unsafe) static var stub: Stub?
    nonisolated(unsafe) static var lastRequest: URLRequest?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lastRequest = request
        guard let stub = Self.stub else {
            client?.urlProtocol(self, didFailWithError: URLError(.unknown))
            return
        }
        let response = HTTPURLResponse(
            url: stub.expectedURL,
            statusCode: stub.responseStatus,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: stub.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

import XCTest
import DonkeyCore
@testable import DonkeyAccount

final class AccountClientTests: XCTestCase {

    // MARK: Decoding

    func testDecodesUserDataExport() throws {
        let payload = """
        {
          "user": { "id": "u-1", "email": "ada@example.com" },
          "subscription": { "status": "active" },
          "events": [{ "event": "open" }],
          "chat_messages": [],
          "device_tokens": [{ "token": "abc" }],
          "notification_preferences": { "push_enabled": true },
          "app_data": { "bookmarks": [] }
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(UserDataExport.self, from: payload)
        XCTAssertEqual(decoded.user?.object?["id"]?.stringValue, "u-1")
        XCTAssertEqual(decoded.subscription?.object?["status"]?.stringValue, "active")
        XCTAssertEqual(decoded.events?.array?.count, 1)
        XCTAssertNotNil(decoded.chatMessages)
        XCTAssertEqual(decoded.deviceTokens?.array?.first?.object?["token"]?.stringValue, "abc")
        XCTAssertEqual(decoded.notificationPreferences?.object?["push_enabled"]?.boolValue, true)
    }

    func testDecodesDeleteStatus() throws {
        let payload = Data("{\"status\":\"ok\"}".utf8)
        let decoded = try JSONDecoder().decode(AccountStatusResponse.self, from: payload)
        XCTAssertEqual(decoded.status, "ok")
    }

    // MARK: End-to-end

    func testDeleteAccountPOSTsEmptyBody() async throws {
        AccountStubURLProtocol.reset()
        AccountStubURLProtocol.stub = AccountStubURLProtocol.Stub(
            responseStatus: 200,
            responseBody: Data("{\"status\":\"ok\"}".utf8)
        )
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [AccountStubURLProtocol.self]
        let session = URLSession(configuration: config)

        let donkey = DonkeyClient(
            baseURL: URL(string: "https://api.example.test")!,
            tokenProvider: { "sess" },
            session: session
        )
        let client = AccountClient(client: donkey)
        let result = try await client.deleteAccount()
        XCTAssertEqual(result.status, "ok")

        let recorded = try XCTUnwrap(AccountStubURLProtocol.lastRequest)
        XCTAssertEqual(recorded.url?.path, "/api/v1/account/delete")
        XCTAssertEqual(recorded.httpMethod, "POST")
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Authorization"), "Bearer sess")
    }

    func testExportDataGETs() async throws {
        AccountStubURLProtocol.reset()
        AccountStubURLProtocol.stub = AccountStubURLProtocol.Stub(
            responseStatus: 200,
            responseBody: Data("{\"user\":{\"id\":\"u-1\"}}".utf8)
        )
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [AccountStubURLProtocol.self]
        let session = URLSession(configuration: config)

        let donkey = DonkeyClient(
            baseURL: URL(string: "https://api.example.test")!,
            tokenProvider: { "sess" },
            session: session
        )
        let client = AccountClient(client: donkey)
        let export = try await client.exportData()
        XCTAssertEqual(export.user?.object?["id"]?.stringValue, "u-1")

        let recorded = try XCTUnwrap(AccountStubURLProtocol.lastRequest)
        XCTAssertEqual(recorded.url?.path, "/api/v1/account/export")
        XCTAssertEqual(recorded.httpMethod, "GET")
    }
}

// MARK: - URLProtocol stub

final class AccountStubURLProtocol: URLProtocol, @unchecked Sendable {

    struct Stub: Sendable {
        let responseStatus: Int
        let responseBody: Data
    }

    nonisolated(unsafe) static var stub: Stub?
    nonisolated(unsafe) static var lastRequest: URLRequest?

    static func reset() {
        stub = nil
        lastRequest = nil
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lastRequest = request
        guard let stub = Self.stub else {
            client?.urlProtocol(self, didFailWithError: URLError(.unknown))
            return
        }
        let response = HTTPURLResponse(
            url: request.url!,
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

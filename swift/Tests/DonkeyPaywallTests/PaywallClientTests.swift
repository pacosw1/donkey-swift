import XCTest
import DonkeyCore
@testable import DonkeyPaywall

final class PaywallClientTests: XCTestCase {

    // MARK: Response decoding

    func testDecodesFullPaywallPayload() throws {
        let payload = """
        {
          "locale": "en",
          "source_locale": "en",
          "config": {
            "headline": "UNLOCK",
            "headline_accent": "SACRED SCROLLS PRO",
            "subtitle": "Deepen your faith",
            "member_count": "10k members",
            "rating": "4.8",
            "features": [
              { "emoji": "heart", "color": "pink", "text": "tests", "bold": "Unlimited" }
            ],
            "reviews": [
              { "title": "Great", "username": "Ada", "time_label": "1d", "description": "Loved it", "rating": 5 }
            ],
            "footer_text": "",
            "trial_text": "Free 7-day trial",
            "cta_text": "Start",
            "version": 3
          }
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(PaywallPayload.self, from: payload)
        XCTAssertEqual(decoded.locale, "en")
        XCTAssertEqual(decoded.sourceLocale, "en")
        XCTAssertEqual(decoded.config.headline, "UNLOCK")
        XCTAssertEqual(decoded.config.headlineAccent, "SACRED SCROLLS PRO")
        XCTAssertEqual(decoded.config.features.first?.bold, "Unlimited")
        XCTAssertEqual(decoded.config.reviews.first?.rating, 5)
        XCTAssertEqual(decoded.config.version, 3)
    }

    func testLenientDecodingWithMissingFields() throws {
        // Server version bump drops a field — client should not crash.
        let payload = """
        {
          "locale": "es",
          "config": {
            "headline": "UNLOCK",
            "features": [],
            "reviews": []
          }
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(PaywallPayload.self, from: payload)
        XCTAssertEqual(decoded.locale, "es")
        XCTAssertEqual(decoded.sourceLocale, "en")
        XCTAssertEqual(decoded.config.headline, "UNLOCK")
        XCTAssertEqual(decoded.config.subtitle, "")
        XCTAssertEqual(decoded.config.version, 1, "missing version should default to 1")
    }

    // MARK: End-to-end with stub transport

    func testGetPaywallHitsExpectedURLAndQuery() async throws {
        PaywallStubURLProtocol.reset()
        PaywallStubURLProtocol.stub = PaywallStubURLProtocol.Stub(
            responseStatus: 200,
            responseBody: minimalPaywallBody()
        )
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [PaywallStubURLProtocol.self]
        let session = URLSession(configuration: config)

        let donkey = DonkeyClient(
            baseURL: URL(string: "https://api.example.test")!,
            tokenProvider: { "sess" },
            stage: .testflight,
            session: session
        )
        let client = PaywallClient(client: donkey)

        let payload = try await client.getPaywall(locale: "en", daysSinceActive: 4)
        XCTAssertEqual(payload.locale, "en")

        let recorded = try XCTUnwrap(PaywallStubURLProtocol.lastRequest)
        let url = try XCTUnwrap(recorded.url)
        XCTAssertEqual(url.path, "/api/v1/paywall")
        let query = url.query ?? ""
        XCTAssertTrue(query.contains("locale=en"), "query was \(query)")
        XCTAssertTrue(query.contains("days_since_active=4"), "query was \(query)")
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Authorization"), "Bearer sess")
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "X-App-Stage"), "testflight")
    }

    func testDismissPaywallIsPostAndAuthed() async throws {
        PaywallStubURLProtocol.reset()
        PaywallStubURLProtocol.stub = PaywallStubURLProtocol.Stub(
            responseStatus: 200,
            responseBody: Data("{\"status\":\"ok\"}".utf8)
        )
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [PaywallStubURLProtocol.self]
        let session = URLSession(configuration: config)

        let donkey = DonkeyClient(
            baseURL: URL(string: "https://api.example.test")!,
            tokenProvider: { "sess" },
            session: session
        )
        let client = PaywallClient(client: donkey)
        try await client.dismissPaywall()

        let recorded = try XCTUnwrap(PaywallStubURLProtocol.lastRequest)
        XCTAssertEqual(recorded.url?.path, "/api/v1/paywall/dismiss")
        XCTAssertEqual(recorded.httpMethod, "POST")
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Authorization"), "Bearer sess")
    }

    private func minimalPaywallBody() -> Data {
        Data("""
        {
          "locale": "en",
          "source_locale": "en",
          "config": { "headline": "x", "features": [], "reviews": [] }
        }
        """.utf8)
    }
}

// MARK: - URLProtocol stub

final class PaywallStubURLProtocol: URLProtocol, @unchecked Sendable {

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

import XCTest
import DonkeyCore
@testable import DonkeyReceipt

final class ReceiptClientTests: XCTestCase {

    // MARK: Wire format

    func testVerifyRequestEncodesSnakeCaseKey() throws {
        // Canonical wire format on the bible-app server is `transaction_jws`
        // in snake_case — matching the rest of the API surface. The old
        // camelCase `transactionJWS` key is kept as a transitional alias on
        // the server side, but new clients always send snake_case.
        struct Probe: Encodable {
            let transactionJws: String
            enum CodingKeys: String, CodingKey {
                case transactionJws = "transaction_jws"
            }
        }
        let data = try JSONEncoder().encode(Probe(transactionJws: "signed.jws"))
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["transaction_jws"] as? String, "signed.jws")
        XCTAssertNil(json["transactionJWS"])
    }

    // MARK: Response decoding

    func testDecodesVerifyResponse() throws {
        let payload = """
        {
          "verified": true,
          "status": "active",
          "product_id": "com.biblestory.pro.monthly",
          "transaction_id": "2000000123456",
          "expires_at": "2026-05-01T12:00:00Z"
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(ReceiptVerifyResponse.self, from: payload)
        XCTAssertTrue(decoded.verified)
        XCTAssertEqual(decoded.status, "active")
        XCTAssertEqual(decoded.productId, "com.biblestory.pro.monthly")
        XCTAssertEqual(decoded.transactionId, "2000000123456")
        XCTAssertNotNil(decoded.expiresAt)
    }

    func testDecodesVerifyResponseMissingExpires() throws {
        let payload = """
        {
          "verified": true,
          "status": "free",
          "product_id": "com.biblestory.lifetime",
          "transaction_id": "200000009999"
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(ReceiptVerifyResponse.self, from: payload)
        XCTAssertEqual(decoded.status, "free")
        XCTAssertNil(decoded.expiresAt)
    }

    // MARK: End-to-end

    func testVerifyHitsExpectedURL() async throws {
        ReceiptStubURLProtocol.reset()
        ReceiptStubURLProtocol.stub = ReceiptStubURLProtocol.Stub(
            responseStatus: 200,
            responseBody: Data("""
            {
              "verified": true,
              "status": "active",
              "product_id": "com.x.pro",
              "transaction_id": "txn-1"
            }
            """.utf8)
        )
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ReceiptStubURLProtocol.self]
        let session = URLSession(configuration: config)

        let donkey = DonkeyClient(
            baseURL: URL(string: "https://api.example.test")!,
            tokenProvider: { "sess" },
            stage: .appstore,
            session: session
        )
        let client = ReceiptClient(client: donkey)
        let result = try await client.verify(transactionJWS: "signed.jws")
        XCTAssertTrue(result.verified)
        XCTAssertEqual(result.status, "active")

        let recorded = try XCTUnwrap(ReceiptStubURLProtocol.lastRequest)
        XCTAssertEqual(recorded.url?.path, "/api/v1/receipts/verify")
        XCTAssertEqual(recorded.httpMethod, "POST")
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Authorization"), "Bearer sess")
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "X-App-Stage"), "appstore")
    }
}

// MARK: - URLProtocol stub

final class ReceiptStubURLProtocol: URLProtocol, @unchecked Sendable {

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

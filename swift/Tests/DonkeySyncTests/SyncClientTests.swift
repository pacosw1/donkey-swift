import XCTest
import DonkeyCore
@testable import DonkeySync

final class SyncClientTests: XCTestCase {

    // MARK: Wire format

    func testBatchItemEncodesSnakeCase() throws {
        let item = SyncBatchItem(
            clientId: "c-1",
            entityType: "bookmark",
            entityId: "srv-42",
            version: 3,
            fields: [
                "verse_id": AnyCodable(.string("Gen.1.1")),
                "note": AnyCodable(.string("hello"))
            ]
        )
        let data = try JSONEncoder().encode(item)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["client_id"] as? String, "c-1")
        XCTAssertEqual(json["entity_type"] as? String, "bookmark")
        XCTAssertEqual(json["entity_id"] as? String, "srv-42")
        XCTAssertEqual(json["version"] as? Int, 3)
        let fields = try XCTUnwrap(json["fields"] as? [String: Any])
        XCTAssertEqual(fields["verse_id"] as? String, "Gen.1.1")
    }

    // MARK: Response decoding

    func testDecodesBatchResponseWithConflict() throws {
        let payload = """
        {
          "items": [
            { "client_id": "c-1", "server_id": "srv-1", "version": 2 }
          ],
          "errors": [
            { "client_id": "c-2", "error": "version_conflict", "is_conflict": true, "server_version": 5 }
          ],
          "synced_at": "2026-04-09T12:00:00Z"
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(SyncBatchResponse.self, from: payload)
        XCTAssertEqual(decoded.items.count, 1)
        XCTAssertEqual(decoded.items[0].serverId, "srv-1")
        XCTAssertEqual(decoded.errors.count, 1)
        XCTAssertTrue(decoded.errors[0].isConflict)
        XCTAssertEqual(decoded.errors[0].serverVersion, 5)
        XCTAssertEqual(decoded.syncedAt, "2026-04-09T12:00:00Z")
    }

    // MARK: End-to-end

    func testPushBatchSendsIdempotencyHeader() async throws {
        SyncStubURLProtocol.reset()
        SyncStubURLProtocol.stub = SyncStubURLProtocol.Stub(
            responseStatus: 200,
            responseBody: Data("""
            { "items": [], "errors": [], "synced_at": "2026-04-09T12:00:00Z" }
            """.utf8)
        )
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [SyncStubURLProtocol.self]
        let session = URLSession(configuration: config)

        let donkey = DonkeyClient(
            baseURL: URL(string: "https://api.example.test")!,
            tokenProvider: { "sess" },
            session: session
        )
        let client = SyncClient(client: donkey)
        _ = try await client.pushBatch(
            items: [],
            deviceId: "dev-1",
            idempotencyKey: "idem-123"
        )

        let recorded = try XCTUnwrap(SyncStubURLProtocol.lastRequest)
        XCTAssertEqual(recorded.url?.path, "/api/v1/sync/batch")
        XCTAssertEqual(recorded.httpMethod, "POST")
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Idempotency-Key"), "idem-123")
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Authorization"), "Bearer sess")
    }

    func testDeleteEntityBuildsPathAndQuery() async throws {
        SyncStubURLProtocol.reset()
        SyncStubURLProtocol.stub = SyncStubURLProtocol.Stub(
            responseStatus: 200,
            responseBody: Data("{\"status\":\"ok\"}".utf8)
        )
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [SyncStubURLProtocol.self]
        let session = URLSession(configuration: config)

        let donkey = DonkeyClient(
            baseURL: URL(string: "https://api.example.test")!,
            tokenProvider: { "sess" },
            session: session
        )
        let client = SyncClient(client: donkey)
        let result = try await client.deleteEntity(
            entityType: "bookmark",
            entityId: "abc-123",
            deviceId: "dev-1"
        )
        XCTAssertEqual(result.status, "ok")

        let recorded = try XCTUnwrap(SyncStubURLProtocol.lastRequest)
        let url = try XCTUnwrap(recorded.url)
        XCTAssertEqual(url.path, "/api/v1/sync/bookmark/abc-123")
        XCTAssertEqual(url.query, "device_id=dev-1")
        XCTAssertEqual(recorded.httpMethod, "DELETE")
    }
}

// MARK: - URLProtocol stub

final class SyncStubURLProtocol: URLProtocol, @unchecked Sendable {

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

import XCTest
import DonkeyCore
@testable import DonkeyChat

final class ChatClientTests: XCTestCase {

    // MARK: Decoding

    func testDecodesHistoryResponse() throws {
        let payload = """
        {
          "messages": [
            {
              "id": 42,
              "user_id": "u-1",
              "sender": "user",
              "message": "hello",
              "message_type": "text",
              "read_at": null,
              "created_at": "2026-04-09T12:00:00Z"
            },
            {
              "id": 43,
              "user_id": "u-1",
              "sender": "admin",
              "message": "hi!",
              "message_type": "text",
              "read_at": "2026-04-09T12:01:00Z",
              "created_at": "2026-04-09T12:00:30Z"
            }
          ],
          "has_more": true
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(ChatHistoryResponse.self, from: payload)
        XCTAssertEqual(decoded.messages.count, 2)
        XCTAssertTrue(decoded.hasMore)
        XCTAssertEqual(decoded.messages[0].id, 42)
        XCTAssertEqual(decoded.messages[0].sender, "user")
        XCTAssertEqual(decoded.messages[1].sender, "admin")
        XCTAssertNotNil(decoded.messages[1].readAt)
    }

    func testDecodesSendResponse() throws {
        let payload = """
        { "status": "ok", "id": 99, "created_at": "2026-04-09T12:05:00Z" }
        """.data(using: .utf8)!
        let response = try JSONDecoder().decode(ChatSendResponse.self, from: payload)
        XCTAssertEqual(response.status, "ok")
        XCTAssertEqual(response.id, 99)
    }

    // MARK: Wire format

    func testSendRequestEncodesSnakeCaseBody() throws {
        struct Probe: Encodable {
            let message: String
            let messageType: String
            let attachment: ChatAttachmentInput?

            private enum CodingKeys: String, CodingKey {
                case message
                case messageType = "message_type"
                case attachment
            }
        }
        let body = Probe(
            message: "hi",
            messageType: "text",
            attachment: ChatAttachmentInput(
                url: "https://cdn.example.test/a.png",
                contentType: "image/png",
                fileName: "a.png",
                sizeBytes: 1024
            )
        )
        let data = try JSONEncoder().encode(body)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["message"] as? String, "hi")
        XCTAssertEqual(json["message_type"] as? String, "text")
        let attachment = try XCTUnwrap(json["attachment"] as? [String: Any])
        XCTAssertEqual(attachment["content_type"] as? String, "image/png")
        XCTAssertEqual(attachment["file_name"] as? String, "a.png")
        XCTAssertEqual(attachment["size_bytes"] as? Int, 1024)
    }

    // MARK: End-to-end

    func testGetHistoryHitsExpectedURLWithQuery() async throws {
        ChatStubURLProtocol.reset()
        ChatStubURLProtocol.stub = ChatStubURLProtocol.Stub(
            responseStatus: 200,
            responseBody: Data("{\"messages\":[],\"has_more\":false}".utf8)
        )
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ChatStubURLProtocol.self]
        let session = URLSession(configuration: config)

        let donkey = DonkeyClient(
            baseURL: URL(string: "https://api.example.test")!,
            tokenProvider: { "sess" },
            session: session
        )
        let client = ChatClient(client: donkey)
        let response = try await client.getHistory(limit: 25, offset: 50, sinceId: 100)
        XCTAssertFalse(response.hasMore)

        let recorded = try XCTUnwrap(ChatStubURLProtocol.lastRequest)
        let url = try XCTUnwrap(recorded.url)
        XCTAssertEqual(url.path, "/api/v1/support-chat/history")
        let query = url.query ?? ""
        XCTAssertTrue(query.contains("limit=25"))
        XCTAssertTrue(query.contains("offset=50"))
        XCTAssertTrue(query.contains("since_id=100"))
    }
}

// MARK: - URLProtocol stub

final class ChatStubURLProtocol: URLProtocol, @unchecked Sendable {

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

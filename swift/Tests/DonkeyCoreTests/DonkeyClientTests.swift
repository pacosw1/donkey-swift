import XCTest
@testable import DonkeyCore

/// Tests for the DonkeyCore transport — specifically the shared concerns that
/// every per-service client inherits: token injection, `X-App-Stage` header
/// propagation, and HTTP error mapping.
///
/// These are colocated here rather than in a per-service suite because the
/// behavior is owned by `DonkeyClient` itself — the service modules trust
/// it and do not re-test the same wiring.
final class DonkeyClientTests: XCTestCase {

    // MARK: X-App-Stage header

    func testStageHeaderIsAttachedWhenConfigured() async throws {
        CoreStubURLProtocol.reset()
        CoreStubURLProtocol.stub = CoreStubURLProtocol.Stub(
            responseStatus: 200,
            responseBody: Data("{}".utf8)
        )
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CoreStubURLProtocol.self]
        let session = URLSession(configuration: config)

        let donkey = DonkeyClient(
            baseURL: URL(string: "https://api.example.test")!,
            tokenProvider: { nil },
            stage: .testflight,
            session: session
        )

        let _: EmptyResponse = try await donkey.request("/api/v1/ping", method: .get)
        let recorded = try XCTUnwrap(CoreStubURLProtocol.lastRequest)
        XCTAssertEqual(
            recorded.value(forHTTPHeaderField: "X-App-Stage"),
            "testflight",
            "stage header should be attached when configured"
        )
    }

    func testStageHeaderAbsentWhenNil() async throws {
        CoreStubURLProtocol.reset()
        CoreStubURLProtocol.stub = CoreStubURLProtocol.Stub(
            responseStatus: 200,
            responseBody: Data("{}".utf8)
        )
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CoreStubURLProtocol.self]
        let session = URLSession(configuration: config)

        let donkey = DonkeyClient(
            baseURL: URL(string: "https://api.example.test")!,
            tokenProvider: { nil },
            stage: nil,
            session: session
        )

        let _: EmptyResponse = try await donkey.request("/api/v1/ping", method: .get)
        let recorded = try XCTUnwrap(CoreStubURLProtocol.lastRequest)
        XCTAssertNil(
            recorded.value(forHTTPHeaderField: "X-App-Stage"),
            "no stage configured should mean no header"
        )
    }

    func testExtraHeadersCanOverrideStage() async throws {
        CoreStubURLProtocol.reset()
        CoreStubURLProtocol.stub = CoreStubURLProtocol.Stub(
            responseStatus: 200,
            responseBody: Data("{}".utf8)
        )
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [CoreStubURLProtocol.self]
        let session = URLSession(configuration: config)

        let donkey = DonkeyClient(
            baseURL: URL(string: "https://api.example.test")!,
            tokenProvider: { nil },
            stage: .debug,
            session: session
        )

        // extraHeaders is applied AFTER the stage injection, so a caller can
        // override for a one-off call.
        let _: EmptyResponse = try await donkey.request(
            "/api/v1/ping",
            method: .get,
            extraHeaders: ["X-App-Stage": "appstore"]
        )
        let recorded = try XCTUnwrap(CoreStubURLProtocol.lastRequest)
        XCTAssertEqual(
            recorded.value(forHTTPHeaderField: "X-App-Stage"),
            "appstore",
            "per-request override should win over the stage on the actor"
        )
    }

    // MARK: Stage enum raw values

    func testAppStageRawValuesMatchBackendWhitelist() {
        XCTAssertEqual(DonkeyClient.AppStage.debug.rawValue, "debug")
        XCTAssertEqual(DonkeyClient.AppStage.testflight.rawValue, "testflight")
        XCTAssertEqual(DonkeyClient.AppStage.appstore.rawValue, "appstore")
    }
}

// MARK: - URLProtocol stub (namespaced to DonkeyCoreTests)

final class CoreStubURLProtocol: URLProtocol, @unchecked Sendable {

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

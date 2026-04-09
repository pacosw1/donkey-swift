import XCTest
import DonkeyCore
@testable import DonkeyNotify

final class NotifyClientTests: XCTestCase {

    // MARK: Wire format

    func testRegisterDeviceEncodesSnakeCaseBody() throws {
        struct Probe: Encodable {
            let token: String
            let platform: String
            let deviceModel: String?
            let osVersion: String?
            let appVersion: String?
            let apnsTopic: String?
            let apnsEnvironment: String?
            let buildChannel: String?

            private enum CodingKeys: String, CodingKey {
                case token
                case platform
                case deviceModel     = "device_model"
                case osVersion       = "os_version"
                case appVersion      = "app_version"
                case apnsTopic       = "apns_topic"
                case apnsEnvironment = "apns_environment"
                case buildChannel    = "build_channel"
            }
        }
        let body = Probe(
            token: "apns-token",
            platform: "ios",
            deviceModel: "iPhone15,3",
            osVersion: "17.4",
            appVersion: "1.0.0",
            apnsTopic: nil,
            apnsEnvironment: "production",
            buildChannel: "testflight"
        )
        let data = try JSONEncoder().encode(body)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["token"] as? String, "apns-token")
        XCTAssertEqual(json["platform"] as? String, "ios")
        XCTAssertEqual(json["device_model"] as? String, "iPhone15,3")
        XCTAssertEqual(json["os_version"] as? String, "17.4")
        XCTAssertEqual(json["app_version"] as? String, "1.0.0")
        XCTAssertEqual(json["apns_environment"] as? String, "production")
        XCTAssertEqual(json["build_channel"] as? String, "testflight")
    }

    func testUpdatePreferencesEncodesOnlyPopulatedFields() throws {
        let update = NotificationPreferencesUpdate(
            pushEnabled: false,
            wakeHour: 9
        )
        let data = try JSONEncoder().encode(update)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["push_enabled"] as? Bool, false)
        XCTAssertEqual(json["wake_hour"] as? Int, 9)
        XCTAssertNil(json["interval_seconds"], "nil fields must not be serialized")
        XCTAssertNil(json["timezone"])
    }

    // MARK: Response decoding

    func testDecodesPreferencesResponse() throws {
        let payload = """
        {
          "user_id": "u-1",
          "push_enabled": true,
          "interval_seconds": 3600,
          "wake_hour": 7,
          "sleep_hour": 23,
          "timezone": "America/New_York",
          "stop_after_goal": true
        }
        """.data(using: .utf8)!

        let prefs = try JSONDecoder().decode(NotificationPreferences.self, from: payload)
        XCTAssertEqual(prefs.userId, "u-1")
        XCTAssertTrue(prefs.pushEnabled)
        XCTAssertEqual(prefs.intervalSeconds, 3600)
        XCTAssertEqual(prefs.wakeHour, 7)
        XCTAssertEqual(prefs.sleepHour, 23)
        XCTAssertEqual(prefs.timezone, "America/New_York")
        XCTAssertTrue(prefs.stopAfterGoal)
    }

    func testDecodesPreferencesWithMissingFields() throws {
        let payload = "{\"user_id\":\"u-1\"}".data(using: .utf8)!
        let prefs = try JSONDecoder().decode(NotificationPreferences.self, from: payload)
        XCTAssertEqual(prefs.userId, "u-1")
        XCTAssertTrue(prefs.pushEnabled, "missing push_enabled should default to true")
        XCTAssertEqual(prefs.timezone, "UTC")
    }

    // MARK: End-to-end

    func testGetPreferencesHitsExpectedURL() async throws {
        NotifyStubURLProtocol.reset()
        NotifyStubURLProtocol.stub = NotifyStubURLProtocol.Stub(
            responseStatus: 200,
            responseBody: Data("""
            {
              "user_id": "u-1",
              "push_enabled": true,
              "interval_seconds": 3600,
              "wake_hour": 8,
              "sleep_hour": 22,
              "timezone": "UTC",
              "stop_after_goal": false
            }
            """.utf8)
        )
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [NotifyStubURLProtocol.self]
        let session = URLSession(configuration: config)

        let donkey = DonkeyClient(
            baseURL: URL(string: "https://api.example.test")!,
            tokenProvider: { "sess" },
            session: session
        )
        let client = NotifyClient(client: donkey)
        let prefs = try await client.getPreferences()
        XCTAssertEqual(prefs.userId, "u-1")

        let recorded = try XCTUnwrap(NotifyStubURLProtocol.lastRequest)
        XCTAssertEqual(recorded.url?.path, "/api/v1/notifications/preferences")
        XCTAssertEqual(recorded.httpMethod, "GET")
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Authorization"), "Bearer sess")
    }
}

// MARK: - URLProtocol stub

final class NotifyStubURLProtocol: URLProtocol, @unchecked Sendable {

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

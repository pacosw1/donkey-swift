import XCTest
import DonkeyCore
@testable import DonkeyFlags

/// Tests for the DonkeyFlags client.
///
/// These cover the wire format round-trip (request encoding, response
/// decoding, typed-value unwrapping) without touching a real server —
/// DonkeyClient is driven by an injected URLSession with a URLProtocol stub.
///
/// The goal is to catch:
///   - incompatible JSON shape vs the TS `POST /api/v1/flags/evaluate` route
///   - regressions in `AnyCodable` decoding for heterogeneous flag values
///   - `FlagEvaluation.isEnabled` semantics (`value === true` only)
final class FlagsClientTests: XCTestCase {

    // MARK: Wire encoding

    func testEncodesRequestWithKeysAndContext() throws {
        let ctx = FlagContext(
            userId: "u-1",
            appVersion: "1.4.2",
            platform: .ios,
            locale: "en-US",
            country: "US",
            isPro: true,
            custom: ["cohort": .string("early_access")]
        )

        // Encode the private request struct indirectly by snapshotting what
        // a Codable with the same shape produces.
        struct Probe: Encodable {
            let keys: [String]?
            let context: FlagContext
        }
        let probe = Probe(keys: ["home_verse_of_the_day"], context: ctx)
        let data = try JSONEncoder().encode(probe)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual((json["keys"] as? [String])?.first, "home_verse_of_the_day")
        let context = try XCTUnwrap(json["context"] as? [String: Any])
        XCTAssertEqual(context["userId"] as? String, "u-1")
        XCTAssertEqual(context["appVersion"] as? String, "1.4.2")
        XCTAssertEqual(context["platform"] as? String, "ios")
        XCTAssertEqual(context["country"] as? String, "US")
        XCTAssertEqual(context["isPro"] as? Bool, true)
        let custom = try XCTUnwrap(context["custom"] as? [String: Any])
        XCTAssertEqual(custom["cohort"] as? String, "early_access")
    }

    // MARK: Response decoding

    func testDecodesEvaluationResponseWithMixedValues() throws {
        let payload = """
        {
          "flags": {
            "home_verse_of_the_day": { "value": true, "matched": true, "ruleId": "legacy-rollout" },
            "reader_chapter_image":  { "value": false, "matched": false },
            "paywall_headline":      { "value": "bold_red", "matched": true, "ruleId": "ab_test", "variantKey": "A" },
            "feature_limit":         { "value": 42, "matched": true, "ruleId": "tier_rule" },
            "theme_tokens":          { "value": {"primary":"#ff0000","radius":8}, "matched": true, "ruleId": "tier_rule" }
          }
        }
        """.data(using: .utf8)!

        struct Response: Decodable { let flags: [String: FlagEvaluation] }
        let decoded = try JSONDecoder().decode(Response.self, from: payload)

        // Boolean flag
        let home = try XCTUnwrap(decoded.flags["home_verse_of_the_day"])
        XCTAssertTrue(home.isEnabled)
        XCTAssertEqual(home.ruleId, "legacy-rollout")
        XCTAssertEqual(home.value.boolValue, true)

        // Disabled flag
        let reader = try XCTUnwrap(decoded.flags["reader_chapter_image"])
        XCTAssertFalse(reader.isEnabled)
        XCTAssertFalse(reader.matched)
        XCTAssertNil(reader.variantKey)

        // A/B string variant
        let paywall = try XCTUnwrap(decoded.flags["paywall_headline"])
        XCTAssertEqual(paywall.value.stringValue, "bold_red")
        XCTAssertEqual(paywall.variantKey, "A")
        XCTAssertFalse(paywall.isEnabled) // "bold_red" is not === true

        // Numeric flag
        let limit = try XCTUnwrap(decoded.flags["feature_limit"])
        XCTAssertEqual(limit.value.intValue, 42)

        // JSON-object flag
        let theme = try XCTUnwrap(decoded.flags["theme_tokens"])
        let obj = try XCTUnwrap(theme.value.object)
        XCTAssertEqual(obj["primary"]?.stringValue, "#ff0000")
        XCTAssertEqual(obj["radius"]?.intValue, 8)
    }

    // MARK: End-to-end with stub transport

    func testEvaluateHitsExpectedURLAndReturnsDecodedResults() async throws {
        let expectedURL = URL(string: "https://api.example.test/api/v1/flags/evaluate")!
        let responseBody = """
        { "flags": { "x": { "value": true, "matched": true, "ruleId": "r1" } } }
        """.data(using: .utf8)!

        StubURLProtocol.stub = StubURLProtocol.Stub(
            expectedURL: expectedURL,
            expectedMethod: "POST",
            responseStatus: 200,
            responseBody: responseBody
        )
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        let session = URLSession(configuration: config)

        let donkey = DonkeyClient(
            baseURL: URL(string: "https://api.example.test")!,
            tokenProvider: { "test-jwt" },
            session: session
        )
        let client = FlagsClient(client: donkey)
        let ctx = FlagContext(userId: "u-1", platform: .ios)

        let results = try await client.evaluate(keys: ["x"], context: ctx)
        XCTAssertEqual(results["x"]?.isEnabled, true)
        XCTAssertEqual(results["x"]?.ruleId, "r1")

        // Verify the outgoing request
        let recorded = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(recorded.url, expectedURL)
        XCTAssertEqual(recorded.httpMethod, "POST")
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Authorization"), "Bearer test-jwt")
        XCTAssertEqual(recorded.value(forHTTPHeaderField: "Content-Type"), "application/json")
    }

    func testEncodesAllContextFieldsIncludingCustomBag() throws {
        let ctx = FlagContext(
            userId: "u-1",
            appVersion: "1.4.2",
            appBuild: "2048",
            platform: .ios,
            deviceModel: "iPhone15,3",
            osVersion: "17.4",
            locale: "en-US",
            country: "US",
            email: "u1@example.com",
            isPro: true,
            userCreatedAt: nil,
            custom: [
                "cohort": .string("early_access"),
                "step": .int(3),
                "ratio": .double(0.25),
                "beta": .bool(true),
            ]
        )

        let data = try JSONEncoder().encode(ctx)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(json["userId"] as? String, "u-1")
        XCTAssertEqual(json["appVersion"] as? String, "1.4.2")
        XCTAssertEqual(json["platform"] as? String, "ios")
        XCTAssertEqual(json["deviceModel"] as? String, "iPhone15,3")
        XCTAssertEqual(json["country"] as? String, "US")
        XCTAssertEqual(json["isPro"] as? Bool, true)

        let custom = try XCTUnwrap(json["custom"] as? [String: Any])
        XCTAssertEqual(custom["cohort"] as? String, "early_access")
        XCTAssertEqual(custom["step"] as? Int, 3)
        XCTAssertEqual(custom["beta"] as? Bool, true)
    }

    func testFlagEvaluationIsEnabledOnlyTrueForLiteralTrue() throws {
        // `value === true` semantics — strings, numbers, objects must NOT
        // register as "enabled" for the bool-only view layer.
        let cases: [(json: String, expected: Bool)] = [
            ("{\"value\":true,\"matched\":true}", true),
            ("{\"value\":false,\"matched\":true}", false),
            ("{\"value\":\"true\",\"matched\":true}", false),     // string "true" != bool true
            ("{\"value\":1,\"matched\":true}", false),             // 1 != true
            ("{\"value\":{\"x\":1},\"matched\":true}", false),     // object != true
            ("{\"value\":null,\"matched\":false}", false),
        ]

        for (json, expected) in cases {
            let data = json.data(using: .utf8)!
            let evaluation = try JSONDecoder().decode(FlagEvaluation.self, from: data)
            XCTAssertEqual(
                evaluation.isEnabled,
                expected,
                "Expected isEnabled=\(expected) for payload: \(json)"
            )
        }
    }

    func testEvaluateBoolReturnsDefaultOnDecodeFailure() async {
        StubURLProtocol.stub = StubURLProtocol.Stub(
            expectedURL: URL(string: "https://api.example.test/api/v1/flags/evaluate")!,
            expectedMethod: "POST",
            responseStatus: 500,
            responseBody: Data("internal".utf8)
        )
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        let session = URLSession(configuration: config)

        let donkey = DonkeyClient(
            baseURL: URL(string: "https://api.example.test")!,
            tokenProvider: { nil },
            session: session
        )
        let client = FlagsClient(client: donkey)
        let ctx = FlagContext(userId: "u-1")

        let result = await client.evaluateBool("anything", context: ctx, default: true)
        XCTAssertTrue(result, "evaluateBool should return the default on failure")
    }
}

// MARK: - URLProtocol stub

/// Minimal URLProtocol stub so FlagsClientTests can drive DonkeyClient
/// against a predictable response without spinning up a real HTTP server.
final class StubURLProtocol: URLProtocol, @unchecked Sendable {

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

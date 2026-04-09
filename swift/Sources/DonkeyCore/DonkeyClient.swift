import Foundation

/// Shared transport for every donkey-swift service client.
///
/// Holds:
///   - the backend base URL
///   - a closure that produces the current auth token (so DonkeyClient does
///     not own auth state — consumers plug in their own JWT store)
///   - a URLSession (injectable for tests)
///
/// An actor so a single instance can be shared across concurrent callers
/// without locking. Per-service clients (e.g. `FlagsClient`) are cheap value
/// types that wrap a `DonkeyClient`.
///
/// Typical setup in an iOS app:
///
///     let donkey = DonkeyClient(
///         baseURL: URL(string: "https://api.sacredscrolls.app")!,
///         tokenProvider: { await AuthStore.shared.currentToken }
///     )
///     let flags = FlagsClient(client: donkey)
///
public actor DonkeyClient {

    /// Build channel the client is running under. Sent as the `X-App-Stage`
    /// header on every request so the backend can fan events out to the
    /// right APNs environment, sandbox vs production receipt validator, etc.
    /// The server middleware whitelists exactly these three values and falls
    /// back to `.appstore` when the header is missing or unrecognized.
    public enum AppStage: String, Sendable {
        case debug
        case testflight
        case appstore
    }

    public let baseURL: URL
    public let stage: AppStage?
    private let session: URLSession
    private let tokenProvider: @Sendable () async -> String?
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(
        baseURL: URL,
        tokenProvider: @escaping @Sendable () async -> String? = { nil },
        stage: AppStage? = nil,
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.stage = stage
        self.session = session
        self.tokenProvider = tokenProvider
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        self.encoder.dateEncodingStrategy = .iso8601
        self.decoder.dateDecodingStrategy = .iso8601
    }

    // MARK: Request

    /// Perform a JSON request and decode the response body into `Response`.
    ///
    /// - Parameters:
    ///   - path: Path component starting with `/`, e.g. `/api/v1/flags/evaluate`.
    ///   - method: HTTP verb. Defaults to `.get`.
    ///   - body: Optional `Encodable` body. For `GET`, pass `nil`.
    ///   - extraHeaders: Additional headers merged on top of the defaults.
    ///
    /// The method injects `Authorization: Bearer <token>` when the token
    /// provider returns a non-nil value, sets `Content-Type: application/json`
    /// on requests that carry a body, and surfaces `401` as `.unauthorized`.
    public func request<Response: Decodable & Sendable>(
        _ path: String,
        method: HTTPMethod = .get,
        body: (any Encodable & Sendable)? = nil,
        extraHeaders: [String: String] = [:]
    ) async throws -> Response {
        let url = try makeURL(path: path)

        var req = URLRequest(url: url)
        req.httpMethod = method.rawValue
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            do {
                req.httpBody = try encoder.encode(AnyEncodable(body))
            } catch {
                throw DonkeyError.invalidRequest(reason: "failed to encode body: \(error)")
            }
        }

        if let token = await tokenProvider(), !token.isEmpty {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        // Attach the build channel identifier so the backend middleware can
        // route events / receipts / notifications to the right environment.
        // Applied BEFORE extraHeaders so per-call overrides still win if a
        // caller explicitly passes a different X-App-Stage.
        if let stage {
            req.setValue(stage.rawValue, forHTTPHeaderField: "X-App-Stage")
        }

        for (k, v) in extraHeaders {
            req.setValue(v, forHTTPHeaderField: k)
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw DonkeyError.network(underlying: error)
        }

        guard let http = response as? HTTPURLResponse else {
            throw DonkeyError.http(status: -1, body: "non-HTTP response")
        }

        if http.statusCode == 401 {
            throw DonkeyError.unauthorized
        }

        guard (200..<300).contains(http.statusCode) else {
            let bodyString = String(data: data, encoding: .utf8) ?? ""
            throw DonkeyError.http(status: http.statusCode, body: bodyString)
        }

        // Allow empty bodies on 204 etc. by decoding "null" for Optionals.
        if data.isEmpty {
            if let empty = EmptyResponse() as? Response { return empty }
        }

        do {
            return try decoder.decode(Response.self, from: data)
        } catch {
            throw DonkeyError.decoding(underlying: error)
        }
    }

    /// Fire-and-forget variant for endpoints that return nothing useful
    /// (e.g. DELETEs that return 204). Checks status, discards body.
    public func requestVoid(
        _ path: String,
        method: HTTPMethod = .get,
        body: (any Encodable & Sendable)? = nil,
        extraHeaders: [String: String] = [:]
    ) async throws {
        let _: EmptyResponse = try await request(path, method: method, body: body, extraHeaders: extraHeaders)
    }

    // MARK: Private helpers

    private func makeURL(path: String) throws -> URL {
        // Split any query string off before we mangle the path, otherwise
        // `NSString.appendingPathComponent` swallows the `?…` portion.
        let trimmed = path.hasPrefix("/") ? path : "/\(path)"
        let pathOnly: String
        let queryString: String?
        if let q = trimmed.firstIndex(of: "?") {
            pathOnly = String(trimmed[..<q])
            queryString = String(trimmed[trimmed.index(after: q)...])
        } else {
            pathOnly = trimmed
            queryString = nil
        }

        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw DonkeyError.invalidRequest(reason: "invalid base URL: \(baseURL)")
        }
        components.path = (components.path as NSString).appendingPathComponent(pathOnly) as String
        // appendingPathComponent above can produce "//api/v1/..." when base path is empty
        components.path = components.path.replacingOccurrences(of: "//", with: "/")
        if let queryString {
            components.percentEncodedQuery = queryString
        }
        guard let url = components.url else {
            throw DonkeyError.invalidRequest(reason: "could not build URL from path: \(path)")
        }
        return url
    }
}

// ── Internal helpers ────────────────────────────────────────────────────────

/// Placeholder response for endpoints that return no body (204, empty 200, ...).
public struct EmptyResponse: Decodable, Sendable {
    public init() {}
    public init(from decoder: Decoder) throws {}
}

/// Type-erases an existential Encodable so JSONEncoder can handle it.
/// JSONEncoder.encode<T: Encodable>(_ value: T) does not accept `any Encodable`
/// directly because existentials don't conform to their own protocol.
struct AnyEncodable: Encodable {
    private let _encode: (Encoder) throws -> Void
    init(_ wrapped: any Encodable) {
        self._encode = { try wrapped.encode(to: $0) }
    }
    func encode(to encoder: Encoder) throws {
        try _encode(encoder)
    }
}

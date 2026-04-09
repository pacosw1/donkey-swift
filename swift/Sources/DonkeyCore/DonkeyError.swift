import Foundation

/// Errors surfaced by DonkeyCore's transport layer.
///
/// Per-service modules re-throw these as-is so callers can switch on a
/// single error type regardless of which donkey-swift service they hit.
public enum DonkeyError: Error, Sendable {
    /// HTTP status outside the 2xx range. The associated values are the
    /// status code and the raw response body (if any) for logging.
    case http(status: Int, body: String)

    /// The response body could not be decoded into the expected shape.
    case decoding(underlying: Error)

    /// Transport-level failure (DNS, timeout, TLS, offline).
    case network(underlying: Error)

    /// 401 from the server — the token provider returned no token or the
    /// token was rejected. Clients should re-auth and retry.
    case unauthorized

    /// The request could not be constructed (e.g. bad URL, bad JSON body).
    case invalidRequest(reason: String)
}

extension DonkeyError: CustomStringConvertible {
    public var description: String {
        switch self {
        case let .http(status, body):
            return "DonkeyError.http(\(status)): \(body)"
        case let .decoding(underlying):
            return "DonkeyError.decoding: \(underlying)"
        case let .network(underlying):
            return "DonkeyError.network: \(underlying)"
        case .unauthorized:
            return "DonkeyError.unauthorized"
        case let .invalidRequest(reason):
            return "DonkeyError.invalidRequest: \(reason)"
        }
    }
}

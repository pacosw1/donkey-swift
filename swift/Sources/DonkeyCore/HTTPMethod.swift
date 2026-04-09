import Foundation

/// HTTP verbs used by the donkey-swift backend services.
/// Kept as a plain enum so each client module can pick what it needs without
/// dragging in a whole HTTP framework.
public enum HTTPMethod: String, Sendable {
    case get    = "GET"
    case post   = "POST"
    case put    = "PUT"
    case delete = "DELETE"
    case patch  = "PATCH"
}

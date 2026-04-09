import Foundation

/// Attributes the backend's targeting engine reasons about when evaluating
/// a flag. Mirrors the `FlagContext` interface in `src/flags/index.ts`.
///
/// Only `userId` is required. Everything else is optional — rules that
/// reference a missing attribute simply don't match (they don't error).
///
/// Typical iOS population:
///
///     let ctx = FlagContext(
///         userId: session.userId,
///         appVersion: Bundle.main.appVersion,
///         platform: .ios,
///         locale: Locale.current.identifier,
///         country: Locale.current.region?.identifier,
///         isPro: subscriptions.isPro,
///         custom: ["cohort": .string("early_access")]
///     )
public struct FlagContext: Codable, Sendable, Equatable {

    public var userId: String

    // App identification
    public var appVersion: String?
    public var appBuild: String?
    public var platform: Platform?
    public var deviceModel: String?
    public var osVersion: String?
    public var locale: String?
    public var country: String?

    // User attributes
    public var email: String?
    public var isPro: Bool?
    public var userCreatedAt: Date?

    /// Escape hatch for app-specific traits. Values can be string / number /
    /// bool — matches the TS `Record<string, string | number | boolean>`.
    public var custom: [String: CustomValue]?

    public enum Platform: String, Codable, Sendable {
        case ios
        case android
        case web
    }

    /// Discriminated value for the `custom` bag. Encodes/decodes as a raw
    /// JSON scalar on the wire (string, number, or bool) to match the TS type.
    public enum CustomValue: Codable, Sendable, Equatable {
        case string(String)
        case int(Int)
        case double(Double)
        case bool(Bool)

        public init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let b = try? c.decode(Bool.self)    { self = .bool(b);   return }
            if let i = try? c.decode(Int.self)     { self = .int(i);    return }
            if let d = try? c.decode(Double.self)  { self = .double(d); return }
            if let s = try? c.decode(String.self)  { self = .string(s); return }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "FlagContext.CustomValue: unsupported JSON scalar")
        }

        public func encode(to encoder: Encoder) throws {
            var c = encoder.singleValueContainer()
            switch self {
            case .string(let s): try c.encode(s)
            case .int(let i):    try c.encode(i)
            case .double(let d): try c.encode(d)
            case .bool(let b):   try c.encode(b)
            }
        }
    }

    public init(
        userId: String,
        appVersion: String? = nil,
        appBuild: String? = nil,
        platform: Platform? = nil,
        deviceModel: String? = nil,
        osVersion: String? = nil,
        locale: String? = nil,
        country: String? = nil,
        email: String? = nil,
        isPro: Bool? = nil,
        userCreatedAt: Date? = nil,
        custom: [String: CustomValue]? = nil
    ) {
        self.userId = userId
        self.appVersion = appVersion
        self.appBuild = appBuild
        self.platform = platform
        self.deviceModel = deviceModel
        self.osVersion = osVersion
        self.locale = locale
        self.country = country
        self.email = email
        self.isPro = isPro
        self.userCreatedAt = userCreatedAt
        self.custom = custom
    }
}

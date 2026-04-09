import Foundation

/// A heterogeneous JSON value that can be decoded without knowing its shape
/// up front.
///
/// Used by `FlagEvaluation.value` because a flag's served value can legally
/// be a bool, string, number, null, array, or object — Swift's Codable
/// machinery needs a concrete type, and `AnyCodable` is the least-effort
/// pragmatic wrapper.
///
/// Prefer the typed accessors (`boolValue`, `stringValue`, `intValue`,
/// `doubleValue`, `stringDict`, `array`) over introspecting `.value` directly.
public struct AnyCodable: Codable, Sendable, Equatable {
    public let value: Value

    public enum Value: Sendable, Equatable {
        case null
        case bool(Bool)
        case int(Int)
        case double(Double)
        case string(String)
        case array([AnyCodable])
        case object([String: AnyCodable])
    }

    public init(_ value: Value) {
        self.value = value
    }

    // MARK: Decodable

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self.value = .null
        } else if let b = try? c.decode(Bool.self) {
            self.value = .bool(b)
        } else if let i = try? c.decode(Int.self) {
            self.value = .int(i)
        } else if let d = try? c.decode(Double.self) {
            self.value = .double(d)
        } else if let s = try? c.decode(String.self) {
            self.value = .string(s)
        } else if let arr = try? c.decode([AnyCodable].self) {
            self.value = .array(arr)
        } else if let dict = try? c.decode([String: AnyCodable].self) {
            self.value = .object(dict)
        } else {
            throw DecodingError.dataCorruptedError(
                in: c,
                debugDescription: "AnyCodable: unsupported JSON value"
            )
        }
    }

    // MARK: Encodable

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case .null:              try c.encodeNil()
        case .bool(let b):       try c.encode(b)
        case .int(let i):        try c.encode(i)
        case .double(let d):     try c.encode(d)
        case .string(let s):     try c.encode(s)
        case .array(let arr):    try c.encode(arr)
        case .object(let dict):  try c.encode(dict)
        }
    }

    // MARK: Typed accessors

    public var boolValue: Bool? {
        if case .bool(let b) = value { return b }
        return nil
    }

    public var stringValue: String? {
        if case .string(let s) = value { return s }
        return nil
    }

    public var intValue: Int? {
        switch value {
        case .int(let i):    return i
        case .double(let d): return Int(d)
        default:             return nil
        }
    }

    public var doubleValue: Double? {
        switch value {
        case .double(let d): return d
        case .int(let i):    return Double(i)
        default:             return nil
        }
    }

    public var array: [AnyCodable]? {
        if case .array(let arr) = value { return arr }
        return nil
    }

    public var object: [String: AnyCodable]? {
        if case .object(let dict) = value { return dict }
        return nil
    }

    /// Convenience: the value coerced to Bool, treating non-true / non-bool
    /// as `false`. Matches the semantics of `evaluation.value === true` on
    /// the TS side.
    public var asBool: Bool {
        boolValue ?? false
    }
}

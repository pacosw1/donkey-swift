import Foundation
import DonkeyCore

/// The result of evaluating a single flag against a FlagContext.
/// Mirrors the TS `EvaluationResult` type in `src/flags/index.ts`.
///
/// `value` is `AnyCodable` because a flag's served value can legally be a
/// bool, string, number, null, array, or object. Use the typed accessors
/// on `AnyCodable` (`boolValue`, `stringValue`, etc.) to pull out what you
/// expect.
public struct FlagEvaluation: Decodable, Sendable, Equatable {
    public let value: AnyCodable
    public let matched: Bool
    public let ruleId: String?
    public let variantKey: String?

    public init(
        value: AnyCodable,
        matched: Bool,
        ruleId: String? = nil,
        variantKey: String? = nil
    ) {
        self.value = value
        self.matched = matched
        self.ruleId = ruleId
        self.variantKey = variantKey
    }

    /// Convenience: true iff the served value decodes to the boolean `true`.
    /// This matches the JS semantics `evaluation.value === true` used by the
    /// TS `isEnabled` compat shim.
    public var isEnabled: Bool {
        value.asBool
    }
}

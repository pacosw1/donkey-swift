import Foundation

/// Response body for `GET /api/v1/eligibility`.
///
/// Mirrors the TS `EngageService.getEligibility` return shape. The
/// `metrics` map is a flexible bag of app-specific counters the server
/// populates from the `EngagementData` interface (e.g. chapters read,
/// minutes listened, streak length).
public struct EligibilityResult: Decodable, Sendable, Equatable {
    public let paywallTrigger: String?
    public let daysActive: Int
    public let currentStreak: Int
    public let isPro: Bool
    public let metrics: [String: Double]

    private enum CodingKeys: String, CodingKey {
        case paywallTrigger = "paywall_trigger"
        case daysActive     = "days_active"
        case currentStreak  = "current_streak"
        case isPro          = "is_pro"
        case metrics
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.paywallTrigger = try c.decodeIfPresent(String.self, forKey: .paywallTrigger)
        self.daysActive     = (try? c.decode(Int.self, forKey: .daysActive)) ?? 0
        self.currentStreak  = (try? c.decode(Int.self, forKey: .currentStreak)) ?? 0
        self.isPro          = (try? c.decode(Bool.self, forKey: .isPro)) ?? false
        // metrics values come back as numbers (int or double) — normalize to Double.
        self.metrics        = (try? c.decode([String: Double].self, forKey: .metrics)) ?? [:]
    }

    public init(
        paywallTrigger: String?,
        daysActive: Int,
        currentStreak: Int,
        isPro: Bool,
        metrics: [String: Double]
    ) {
        self.paywallTrigger = paywallTrigger
        self.daysActive = daysActive
        self.currentStreak = currentStreak
        self.isPro = isPro
        self.metrics = metrics
    }
}

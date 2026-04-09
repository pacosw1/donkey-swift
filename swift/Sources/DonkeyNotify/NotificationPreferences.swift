import Foundation

/// User-level push notification preferences.
///
/// Mirrors the `NotificationPreferences` interface in the
/// `donkey-swift/notify` package. All fields are lenient-decoded so the
/// server can add new rows without breaking the iOS client.
public struct NotificationPreferences: Codable, Sendable, Equatable {
    public let userId: String
    public let pushEnabled: Bool
    public let intervalSeconds: Int
    public let wakeHour: Int
    public let sleepHour: Int
    public let timezone: String
    public let stopAfterGoal: Bool

    private enum CodingKeys: String, CodingKey {
        case userId          = "user_id"
        case pushEnabled     = "push_enabled"
        case intervalSeconds = "interval_seconds"
        case wakeHour        = "wake_hour"
        case sleepHour       = "sleep_hour"
        case timezone
        case stopAfterGoal   = "stop_after_goal"
    }

    public init(
        userId: String,
        pushEnabled: Bool,
        intervalSeconds: Int,
        wakeHour: Int,
        sleepHour: Int,
        timezone: String,
        stopAfterGoal: Bool
    ) {
        self.userId = userId
        self.pushEnabled = pushEnabled
        self.intervalSeconds = intervalSeconds
        self.wakeHour = wakeHour
        self.sleepHour = sleepHour
        self.timezone = timezone
        self.stopAfterGoal = stopAfterGoal
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.userId          = (try? c.decode(String.self, forKey: .userId)) ?? ""
        self.pushEnabled     = (try? c.decode(Bool.self, forKey: .pushEnabled)) ?? true
        self.intervalSeconds = (try? c.decode(Int.self, forKey: .intervalSeconds)) ?? 86_400
        self.wakeHour        = (try? c.decode(Int.self, forKey: .wakeHour)) ?? 8
        self.sleepHour       = (try? c.decode(Int.self, forKey: .sleepHour)) ?? 22
        self.timezone        = (try? c.decode(String.self, forKey: .timezone)) ?? "UTC"
        self.stopAfterGoal   = (try? c.decode(Bool.self, forKey: .stopAfterGoal)) ?? false
    }
}

/// Partial update payload for `PUT /api/v1/notifications/preferences/update`.
/// Only populated fields are sent — the server merges them onto the existing
/// row, matching the `Partial<…>` shape of the TS `updatePreferences` call.
public struct NotificationPreferencesUpdate: Encodable, Sendable, Equatable {
    public var pushEnabled: Bool?
    public var intervalSeconds: Int?
    public var wakeHour: Int?
    public var sleepHour: Int?
    public var timezone: String?
    public var stopAfterGoal: Bool?

    public init(
        pushEnabled: Bool? = nil,
        intervalSeconds: Int? = nil,
        wakeHour: Int? = nil,
        sleepHour: Int? = nil,
        timezone: String? = nil,
        stopAfterGoal: Bool? = nil
    ) {
        self.pushEnabled = pushEnabled
        self.intervalSeconds = intervalSeconds
        self.wakeHour = wakeHour
        self.sleepHour = sleepHour
        self.timezone = timezone
        self.stopAfterGoal = stopAfterGoal
    }

    private enum CodingKeys: String, CodingKey {
        case pushEnabled     = "push_enabled"
        case intervalSeconds = "interval_seconds"
        case wakeHour        = "wake_hour"
        case sleepHour       = "sleep_hour"
        case timezone
        case stopAfterGoal   = "stop_after_goal"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(pushEnabled, forKey: .pushEnabled)
        try c.encodeIfPresent(intervalSeconds, forKey: .intervalSeconds)
        try c.encodeIfPresent(wakeHour, forKey: .wakeHour)
        try c.encodeIfPresent(sleepHour, forKey: .sleepHour)
        try c.encodeIfPresent(timezone, forKey: .timezone)
        try c.encodeIfPresent(stopAfterGoal, forKey: .stopAfterGoal)
    }
}

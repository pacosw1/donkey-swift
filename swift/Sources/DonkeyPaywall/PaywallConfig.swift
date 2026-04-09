import Foundation

/// Server-driven paywall configuration returned by
/// `GET /api/v1/paywall`. Mirrors the `PaywallConfig` TS interface in
/// `donkey-swift/paywall`, with lenient decoding so a new server field
/// never crashes older clients.
public struct PaywallConfig: Codable, Sendable, Equatable {
    public let headline: String
    public let headlineAccent: String
    public let subtitle: String
    public let memberCount: String
    public let rating: String
    public let features: [PaywallFeature]
    public let reviews: [PaywallReview]
    public let footerText: String
    public let trialText: String
    public let ctaText: String
    public let version: Int

    private enum CodingKeys: String, CodingKey {
        case headline
        case headlineAccent = "headline_accent"
        case subtitle
        case memberCount    = "member_count"
        case rating
        case features
        case reviews
        case footerText     = "footer_text"
        case trialText      = "trial_text"
        case ctaText        = "cta_text"
        case version
    }

    public init(
        headline: String,
        headlineAccent: String,
        subtitle: String,
        memberCount: String,
        rating: String,
        features: [PaywallFeature],
        reviews: [PaywallReview],
        footerText: String,
        trialText: String,
        ctaText: String,
        version: Int
    ) {
        self.headline = headline
        self.headlineAccent = headlineAccent
        self.subtitle = subtitle
        self.memberCount = memberCount
        self.rating = rating
        self.features = features
        self.reviews = reviews
        self.footerText = footerText
        self.trialText = trialText
        self.ctaText = ctaText
        self.version = version
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.headline       = (try? c.decode(String.self, forKey: .headline)) ?? ""
        self.headlineAccent = (try? c.decode(String.self, forKey: .headlineAccent)) ?? ""
        self.subtitle       = (try? c.decode(String.self, forKey: .subtitle)) ?? ""
        self.memberCount    = (try? c.decode(String.self, forKey: .memberCount)) ?? ""
        self.rating         = (try? c.decode(String.self, forKey: .rating)) ?? ""
        self.features       = (try? c.decode([PaywallFeature].self, forKey: .features)) ?? []
        self.reviews        = (try? c.decode([PaywallReview].self, forKey: .reviews)) ?? []
        self.footerText     = (try? c.decode(String.self, forKey: .footerText)) ?? ""
        self.trialText      = (try? c.decode(String.self, forKey: .trialText)) ?? ""
        self.ctaText        = (try? c.decode(String.self, forKey: .ctaText)) ?? ""
        self.version        = (try? c.decode(Int.self, forKey: .version)) ?? 1
    }
}

/// A single feature bullet rendered on the paywall. Matches
/// `donkey-swift/paywall` `Feature` interface.
public struct PaywallFeature: Codable, Sendable, Equatable {
    public let emoji: String
    public let color: String
    public let text: String
    public let bold: String

    public init(emoji: String, color: String, text: String, bold: String) {
        self.emoji = emoji
        self.color = color
        self.text = text
        self.bold = bold
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.emoji = (try? c.decode(String.self, forKey: .emoji)) ?? ""
        self.color = (try? c.decode(String.self, forKey: .color)) ?? ""
        self.text  = (try? c.decode(String.self, forKey: .text)) ?? ""
        self.bold  = (try? c.decode(String.self, forKey: .bold)) ?? ""
    }

    private enum CodingKeys: String, CodingKey {
        case emoji, color, text, bold
    }
}

/// A user review card rendered on the paywall. Matches
/// `donkey-swift/paywall` `Review` interface.
public struct PaywallReview: Codable, Sendable, Equatable {
    public let title: String
    public let username: String
    public let timeLabel: String
    public let description: String
    public let rating: Int

    private enum CodingKeys: String, CodingKey {
        case title
        case username
        case timeLabel = "time_label"
        case description
        case rating
    }

    public init(
        title: String,
        username: String,
        timeLabel: String,
        description: String,
        rating: Int
    ) {
        self.title = title
        self.username = username
        self.timeLabel = timeLabel
        self.description = description
        self.rating = rating
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.title       = (try? c.decode(String.self, forKey: .title)) ?? ""
        self.username    = (try? c.decode(String.self, forKey: .username)) ?? ""
        self.timeLabel   = (try? c.decode(String.self, forKey: .timeLabel)) ?? ""
        self.description = (try? c.decode(String.self, forKey: .description)) ?? ""
        self.rating      = (try? c.decode(Int.self, forKey: .rating)) ?? 5
    }
}

/// Full response from `GET /api/v1/paywall` — includes the config plus the
/// resolved locale and an optional active conversion offer. The bible-app
/// monetization route adapts the raw `PaywallConfig` into this envelope.
public struct PaywallPayload: Decodable, Sendable, Equatable {
    public let locale: String
    public let sourceLocale: String
    public let config: PaywallConfig

    private enum CodingKeys: String, CodingKey {
        case locale
        case sourceLocale = "source_locale"
        case config
    }

    public init(locale: String, sourceLocale: String, config: PaywallConfig) {
        self.locale = locale
        self.sourceLocale = sourceLocale
        self.config = config
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.locale       = (try? c.decode(String.self, forKey: .locale)) ?? "en"
        self.sourceLocale = (try? c.decode(String.self, forKey: .sourceLocale)) ?? "en"
        self.config       = try c.decode(PaywallConfig.self, forKey: .config)
    }
}

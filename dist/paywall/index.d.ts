export interface Feature {
    emoji: string;
    color: string;
    text: string;
    bold: string;
}
export interface Review {
    title: string;
    username: string;
    time_label: string;
    description: string;
    rating: number;
}
export interface PaywallConfig {
    headline: string;
    headline_accent: string;
    subtitle: string;
    member_count: string;
    rating: string;
    features: Feature[];
    reviews: Review[];
    footer_text: string;
    trial_text: string;
    cta_text: string;
    version: number;
}
export declare class PaywallStore {
    private configs;
    constructor(initial?: Record<string, PaywallConfig>);
    /** Get config for a locale, with language prefix and "en" fallback. */
    get(locale: string): PaywallConfig | null;
    /** Set config for a locale, auto-incrementing version. */
    set(locale: string, config: PaywallConfig): void;
}
//# sourceMappingURL=index.d.ts.map
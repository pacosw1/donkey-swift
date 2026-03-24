// ── Types ───────────────────────────────────────────────────────────────────
// ── Store ───────────────────────────────────────────────────────────────────
export class PaywallStore {
    configs;
    constructor(initial) {
        this.configs = new Map(Object.entries(initial ?? {}));
    }
    /** Get config for a locale, with language prefix and "en" fallback. */
    get(locale) {
        if (this.configs.has(locale))
            return this.configs.get(locale);
        if (locale.length >= 2 && this.configs.has(locale.slice(0, 2))) {
            return this.configs.get(locale.slice(0, 2));
        }
        return this.configs.get("en") ?? null;
    }
    /** Set config for a locale, auto-incrementing version. */
    set(locale, config) {
        const existing = this.configs.get(locale);
        const stored = { ...config, version: existing ? existing.version + 1 : 1 };
        this.configs.set(locale, stored);
    }
}
//# sourceMappingURL=index.js.map
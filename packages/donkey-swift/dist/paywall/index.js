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
        config.version = existing ? existing.version + 1 : 1;
        this.configs.set(locale, config);
    }
}
// ── Handlers ────────────────────────────────────────────────────────────────
/** GET /api/v1/paywall/config?locale=en */
export function handleGetConfig(store) {
    return async (c) => {
        const locale = c.req.query("locale") ?? "en";
        const config = store.get(locale);
        if (!config)
            return c.json({ error: "no paywall config available" }, 404);
        return c.json(config);
    };
}
/** PUT /admin/api/paywall/config?locale=en */
export function handleUpdateConfig(store) {
    return async (c) => {
        const locale = c.req.query("locale") ?? "en";
        const config = await c.req.json();
        store.set(locale, config);
        return c.json({ status: "updated", locale, version: config.version });
    };
}
//# sourceMappingURL=index.js.map
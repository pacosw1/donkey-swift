import type { Context } from "hono";

// ── Types ───────────────────────────────────────────────────────────────────

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

// ── Store ───────────────────────────────────────────────────────────────────

export class PaywallStore {
  private configs: Map<string, PaywallConfig>;

  constructor(initial?: Record<string, PaywallConfig>) {
    this.configs = new Map(Object.entries(initial ?? {}));
  }

  /** Get config for a locale, with language prefix and "en" fallback. */
  get(locale: string): PaywallConfig | null {
    if (this.configs.has(locale)) return this.configs.get(locale)!;
    if (locale.length >= 2 && this.configs.has(locale.slice(0, 2))) {
      return this.configs.get(locale.slice(0, 2))!;
    }
    return this.configs.get("en") ?? null;
  }

  /** Set config for a locale, auto-incrementing version. */
  set(locale: string, config: PaywallConfig): void {
    const existing = this.configs.get(locale);
    const stored = { ...config, version: existing ? existing.version + 1 : 1 };
    this.configs.set(locale, stored);
  }
}

// ── Handlers ────────────────────────────────────────────────────────────────

/** GET /api/v1/paywall/config?locale=en */
export function handleGetConfig(store: PaywallStore) {
  return async (c: Context) => {
    const locale = c.req.query("locale") ?? "en";
    const config = store.get(locale);
    if (!config) return c.json({ error: "no paywall config available" }, 404);
    return c.json(config);
  };
}

/** PUT /admin/api/paywall/config?locale=en */
export function handleUpdateConfig(store: PaywallStore) {
  return async (c: Context) => {
    const locale = c.req.query("locale") ?? "en";
    const config = await c.req.json<PaywallConfig>();
    store.set(locale, config);
    return c.json({ status: "updated", locale, version: config.version });
  };
}

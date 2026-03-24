import { describe, it, expect } from "vitest";
import { PaywallStore, type PaywallConfig } from "../paywall/index.js";

function makeConfig(overrides: Partial<PaywallConfig> = {}): PaywallConfig {
  return {
    headline: "Go Premium",
    headline_accent: "Premium",
    subtitle: "Unlock everything",
    member_count: "10,000+",
    rating: "4.9",
    features: [],
    reviews: [],
    footer_text: "Cancel anytime",
    trial_text: "7-day free trial",
    cta_text: "Start Trial",
    version: 0,
    ...overrides,
  };
}

describe("PaywallStore", () => {
  it("get returns config for exact locale", () => {
    const store = new PaywallStore({ en: makeConfig({ headline: "English" }) });
    const cfg = store.get("en");
    expect(cfg).not.toBeNull();
    expect(cfg!.headline).toBe("English");
  });

  it("get falls back to language prefix", () => {
    const store = new PaywallStore({ es: makeConfig({ headline: "Spanish" }) });
    const cfg = store.get("es-MX");
    expect(cfg).not.toBeNull();
    expect(cfg!.headline).toBe("Spanish");
  });

  it("get falls back to 'en' when locale not found", () => {
    const store = new PaywallStore({ en: makeConfig({ headline: "English Fallback" }) });
    const cfg = store.get("ja");
    expect(cfg).not.toBeNull();
    expect(cfg!.headline).toBe("English Fallback");
  });

  it("get returns null when no config exists", () => {
    const store = new PaywallStore();
    expect(store.get("en")).toBeNull();
  });

  it("set auto-increments version from 0 to 1", () => {
    const store = new PaywallStore();
    const cfg = makeConfig();
    store.set("en", cfg);
    expect(cfg.version).toBe(1);
  });

  it("set increments version on subsequent updates", () => {
    const store = new PaywallStore();
    store.set("en", makeConfig());
    const cfg2 = makeConfig();
    store.set("en", cfg2);
    expect(cfg2.version).toBe(2);
  });

  it("set tracks versions independently per locale", () => {
    const store = new PaywallStore();
    store.set("en", makeConfig());
    store.set("en", makeConfig());
    store.set("es", makeConfig());
    expect(store.get("en")!.version).toBe(2);
    expect(store.get("es")!.version).toBe(1);
  });

  it("exact locale match takes priority over prefix", () => {
    const store = new PaywallStore({
      es: makeConfig({ headline: "Generic Spanish" }),
      "es-MX": makeConfig({ headline: "Mexican Spanish" }),
    });
    expect(store.get("es-MX")!.headline).toBe("Mexican Spanish");
    expect(store.get("es")!.headline).toBe("Generic Spanish");
    expect(store.get("es-AR")!.headline).toBe("Generic Spanish");
  });
});

import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "@/lib/config/env";

const liveBase = {
  APP_MODE: "live",
  APP_BASE_URL: "https://studio.example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk",
  SUPABASE_SERVICE_ROLE_KEY: "sr",
  TRIGGER_SECRET_KEY: "tr_dev_x",
  TRIGGER_PROJECT_REF: "proj_x",
};

describe("configuration", () => {
  it("defaults to demo without any secret", () => {
    const c = parseConfig({});
    expect(c.mode).toBe("demo");
    expect(c.videoPrice).toBeDefined();
    expect(c.flags.realGeneration).toBe(false);
  });

  it("live mode with missing infrastructure throws instead of falling back to demo", () => {
    expect(() => parseConfig({ APP_MODE: "live" })).toThrow(ConfigError);
    expect(() => parseConfig({ ...liveBase, SUPABASE_SERVICE_ROLE_KEY: "" })).toThrow(/SUPABASE/);
  });

  it("live mode keeps real generation off by default and explains why", () => {
    const c = parseConfig({ ...liveBase, HEDRA_API_KEY: "k" });
    expect(c.mode).toBe("live");
    expect(c.flags.realGeneration).toBe(false);
    expect(c.realGenerationBlockers.join(" ")).toMatch(/REAL_GENERATION_ENABLED/);
    expect(c.videoPrice).toBeUndefined();
  });

  it("real generation requires flag, key, verified prices and spending caps (fail closed)", () => {
    const full = {
      ...liveBase,
      REAL_GENERATION_ENABLED: "true",
      HEDRA_API_KEY: "k",
      HEDRA_PRICE_VERSION: "hedra-2026-10-08",
      HEDRA_RATE_MICROS_540P: "25000",
      HEDRA_RATE_MICROS_720P: "50000",
      HEDRA_RATE_MICROS_1080P: "62500",
      MAX_GENERATION_COST_MINOR: "200",
    };
    expect(parseConfig(full).flags.realGeneration).toBe(false); // daily budget missing
    expect(parseConfig({ ...full, DAILY_PROVIDER_BUDGET_MINOR: "2000" }).flags.realGeneration).toBe(true);
  });

  it("refuses a live Stripe key unless explicitly enabled", () => {
    expect(() => parseConfig({ STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "whsec" })).toThrow(/STRIPE_LIVE_ENABLED/);
    expect(parseConfig({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec" }).stripe).toBeDefined();
  });

  it("demo secret never validates in live mode", () => {
    const c = parseConfig({ ...liveBase, DEMO_SECRET: "known-secret" });
    expect(c.demo.secret).not.toBe("known-secret");
  });

  it("caps the V1 duration at 30 seconds", () => {
    expect(() => parseConfig({ MAX_VIDEO_DURATION_SECONDS: "60" })).toThrow();
  });
});

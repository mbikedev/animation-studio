import { describe, expect, it } from "vitest";
import { billableSeconds, computeEstimate, creditsForCost, videoCostMinor } from "@/lib/billing/pricing";
import { DEMO_PRICE_TABLE } from "@/lib/config/env";

const table = { ...DEMO_PRICE_TABLE, ratePerSecondMicros: { ...DEMO_PRICE_TABLE.ratePerSecondMicros } };
const policy = { creditValueMinor: 5, markupBps: 15000 };

describe("pricing", () => {
  it("bills every started second", () => {
    expect(billableSeconds(1)).toBe(1);
    expect(billableSeconds(1000)).toBe(1);
    expect(billableSeconds(1001)).toBe(2);
    expect(billableSeconds(30_000)).toBe(30);
    expect(() => billableSeconds(0)).toThrow();
    expect(() => billableSeconds(Number.NaN)).toThrow();
  });

  it("matches the reference example: 30 s at 720p = 1.50 USD", () => {
    expect(videoCostMinor(table, 30_000, "720p")).toBe(150);
    expect(videoCostMinor(table, 30_000, "540p")).toBe(75);
    expect(videoCostMinor(table, 30_000, "1080p")).toBe(188); // 187.5 rounded up
  });

  it("rounds fractional cents up, with integers only", () => {
    expect(videoCostMinor(table, 1_000, "540p")).toBe(3); // 2.5 -> 3
    expect(Number.isInteger(videoCostMinor(table, 7_300, "1080p"))).toBe(true);
  });

  it("converts cost to whole credits with markup", () => {
    expect(creditsForCost(150, policy)).toBe(45); // 150 * 1.5 / 5
    expect(creditsForCost(1, policy)).toBe(1);
    expect(creditsForCost(0, policy)).toBe(0);
  });

  it("produces a versioned quote that changes with the price", () => {
    const a = computeEstimate({ durationMs: 3000, resolution: "720p" }, table, policy);
    const b = computeEstimate({ durationMs: 3000, resolution: "720p" }, { ...table, version: "v2" }, policy);
    expect(a.priceVersion).toBe(table.version);
    expect(a.quoteId).not.toBe(b.quoteId);
    expect(a.estimatedCostMinor).toBe(15);
    expect(a.credits).toBe(5);
  });

  it("rejects resolutions without a configured rate", () => {
    expect(() => videoCostMinor({ ...table, ratePerSecondMicros: { ...table.ratePerSecondMicros, "1080p": 0 } }, 1000, "1080p")).toThrow();
  });
});

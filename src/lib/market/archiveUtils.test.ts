import { describe, expect, it } from "vitest";
import { archiveUnits, estimateFundingRates, parseCsvRows, rowsToCandles, rowsToFunding } from "./archiveUtils";

const HOUR = 3_600_000;

describe("parseCsvRows", () => {
  it("skips header and blank lines", () => {
    const text = "open_time,open,high,low,close,volume\n1000,1,2,0.5,1.5,10\n\n2000,1.5,3,1,2,20\n";
    const candles = rowsToCandles(parseCsvRows(text));
    expect(candles).toEqual([
      { time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time: 2000, open: 1.5, high: 3, low: 1, close: 2, volume: 20 },
    ]);
  });

  it("parses funding rows and interval", () => {
    const { rates, intervalHours } = rowsToFunding(
      parseCsvRows("calc_time,funding_interval_hours,last_funding_rate\n1780272000001,8,0.00005703\n"),
    );
    expect(rates).toEqual([{ time: 1780272000001, rate: 0.00005703, markPrice: null }]);
    expect(intervalHours).toBe(8);
  });
});

describe("archiveUnits", () => {
  it("uses monthly files before the current month and daily files up to yesterday", () => {
    const now = Date.UTC(2026, 8, 3, 12);
    const units = archiveUnits(Date.UTC(2026, 6, 20), Date.UTC(2026, 8, 3, 12), now);
    expect(units.map((u) => u.label)).toEqual(["2026-07", "2026-08", "2026-09-01", "2026-09-02"]);
  });

  it("returns nothing when the range starts today", () => {
    const now = Date.UTC(2026, 8, 3, 12);
    expect(archiveUnits(Date.UTC(2026, 8, 3), now, now)).toEqual([]);
  });
});

describe("estimateFundingRates", () => {
  const flatPremium = (from: number, to: number, value: number) => {
    const map = new Map<number, number>();
    for (let t = from; t < to; t += 60_000) map.set(t, value);
    return map;
  };

  it("equals the interest rate when premium is near zero", () => {
    const t0 = Date.UTC(2026, 8, 1);
    const rates = estimateFundingRates(flatPremium(t0, t0 + 16 * HOUR, 0), t0, t0 + 16 * HOUR, 8);
    expect(rates.map((r) => r.time)).toEqual([t0 + 8 * HOUR, t0 + 16 * HOUR]);
    expect(rates[0].rate).toBeCloseTo(0.0001, 12);
    expect(rates[0].estimated).toBe(true);
  });

  it("clamps the interest adjustment to ±0.05%", () => {
    const t0 = Date.UTC(2026, 8, 1);
    const [rate] = estimateFundingRates(flatPremium(t0, t0 + 8 * HOUR, 0.001), t0, t0 + 8 * HOUR, 8);
    expect(rate.rate).toBeCloseTo(0.0005, 12);
  });

  it("scales interest for 4h intervals and skips periods without data", () => {
    const t0 = Date.UTC(2026, 8, 1);
    const rates = estimateFundingRates(flatPremium(t0, t0 + 4 * HOUR, 0), t0, t0 + 8 * HOUR, 4);
    expect(rates).toHaveLength(1);
    expect(rates[0].rate).toBeCloseTo(0.00005, 12);
  });
});

import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market/types";
import { atr, donchian, ema, sma } from "./indicators";
import { candlesFromCloses } from "./testUtils";

describe("indicators", () => {
  it("computes simple moving averages", () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
  });

  it("seeds the EMA with a simple average", () => {
    const out = ema([2, 4, 6, 8], 2);
    expect(out[0]).toBeNull();
    expect(out[1]).toBe(3);
    expect(out[2]).toBeCloseTo(6 * (2 / 3) + 3 * (1 / 3), 12);
  });

  it("smooths true range with Wilder's method", () => {
    const candles = candlesFromCloses(10, [10, 10, 12]);
    // 真实波幅：0、0、2
    expect(atr(candles, 2)).toEqual([null, 0, 1]);
  });

  it("builds Donchian channels from previous bars only", () => {
    const candles: Candle[] = [5, 7, 6, 9, 4, 8].map((v, i) => ({
      time: i,
      open: v,
      high: v + 1,
      low: v - 1,
      close: v,
      volume: 0,
    }));
    const { upper, lower } = donchian(candles, 3);
    expect(upper).toEqual([null, null, null, 8, 10, 10]);
    expect(lower).toEqual([null, null, null, 4, 5, 3]);
  });
});

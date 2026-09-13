import { describe, expect, it } from "vitest";
import {
  donchianSignals,
  runTrendScanCell,
  runTrendSimulation,
  validateTrendParams,
  type TrendParams,
} from "./trend";
import { HOUR, T0, candlesFromCloses } from "./testUtils";

const params: TrendParams = {
  market: "spot",
  investment: 1000,
  allowShort: false,
  maType: "sma",
  fastPeriod: 2,
  slowPeriod: 3,
  entryPeriod: 2,
  exitPeriod: 2,
  atrPeriod: 2,
  atrStop: 0,
  makerFee: 0,
  takerFee: 0,
  leverage: 1,
  maintenanceMarginRate: 0.005,
  includeFunding: false,
};

// 快线 SMA2 在第 3 根收盘上穿慢线 SMA3，在第 7 根收盘跌破
const CLOSES = [10, 10, 10, 12, 14, 16, 14, 10, 8];

function run(closes: number[], overrides: Partial<TrendParams>, id: string) {
  const [result] = runTrendSimulation(candlesFromCloses(closes[0], closes), [], HOUR, { ...params, ...overrides }, id);
  return result;
}

describe("moving average crossover", () => {
  it("acts on the next bar open after a signal", () => {
    const r = run(CLOSES, {}, "ma-cross");
    expect(r.trades.map((t) => `${t.action}:${t.side}@${t.price}`)).toEqual(["open:buy@12", "close:sell@10"]);
    expect(r.trades.map((t) => (t.time - T0) / HOUR)).toEqual([4, 8]);
    expect(r.finalEquity).toBeCloseTo((1000 / 12) * 10, 9);
    expect(r.metrics.roundTrips).toBe(1);
    expect(r.metrics.winRate).toBe(0);
  });

  it("reverses into shorts on futures when allowed", () => {
    const r = run(CLOSES, { market: "futures", allowShort: true }, "ma-cross");
    expect(r.trades.map((t) => `${t.action}:${t.side}@${t.price}`)).toEqual([
      "open:sell@10",
      "close:buy@12",
      "open:buy@12",
      "close:sell@10",
      "open:sell@10",
    ]);
  });

  it("stops out with an ATR stop and waits for a new signal", () => {
    // 入场价 12，上一根 ATR = 1，2 倍 ATR 止损价 = 10
    const r = run([10, 10, 10, 12, 14, 16, 5], { atrStop: 2 }, "ma-cross");
    expect(r.trades.map((t) => `${t.action}@${t.price}`)).toEqual(["open@12", "stopLoss@10"]);
    expect(r.metrics.stops).toBe(1);
  });
});

describe("donchian breakout", () => {
  it("enters on a close above the prior high and exits below the prior low", () => {
    const candles = candlesFromCloses(10, [10, 10, 12, 13, 11, 9]);
    // 通道：前 2 根的最高 / 最低价（高低点为开收盘极值）
    expect(donchianSignals(candles, 2, 2, false)).toEqual([0, 0, 1, 1, 1, 0]);
  });
});

describe("trend params", () => {
  it("requires the fast period to be shorter", () => {
    expect(validateTrendParams(params)).toBeNull();
    expect(validateTrendParams({ ...params, fastPeriod: 3 })).toMatch(/快线/);
  });

  it("marks invalid scan cells as not applicable", () => {
    const candles = candlesFromCloses(10, CLOSES);
    expect(runTrendScanCell(candles, [], HOUR, params, "ma-cross", "all", 5, 5)).toBeNull();
    expect(runTrendScanCell(candles, [], HOUR, params, "ma-cross", "all", 2, 3)).not.toBeNull();
  });
});

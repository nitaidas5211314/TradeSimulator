import { describe, expect, it } from "vitest";
import type { Candle, FundingRate } from "@/lib/market/types";
import { buildGridLevels, runGridSimulation, validateGridParams, type GridParams } from "./grid";
import { HOUR, T0, candlesFromCloses } from "./testUtils";

const baseParams: GridParams = {
  market: "spot",
  investment: 1000,
  lower: 90,
  upper: 110,
  gridCount: 2,
  gridMode: "arithmetic",
  leverage: 1,
  makerFee: 0,
  takerFee: 0,
  maintenanceMarginRate: 0.005,
  includeFunding: true,
  stopAbove: null,
  stopBelow: null,
};

function run(candles: Candle[], params: Partial<GridParams>, funding: FundingRate[] = []) {
  const results = runGridSimulation(candles, funding, HOUR, { ...baseParams, ...params });
  return (id: string) => {
    const r = results.find((x) => x.id === id);
    if (!r) throw new Error(`missing ${id}`);
    return r;
  };
}

describe("buildGridLevels", () => {
  it("builds arithmetic levels", () => {
    expect(buildGridLevels(100, 200, 4, "arithmetic")).toEqual([100, 125, 150, 175, 200]);
  });

  it("builds geometric levels", () => {
    const levels = buildGridLevels(100, 400, 2, "geometric");
    expect(levels[0]).toBe(100);
    expect(levels[1]).toBeCloseTo(200);
    expect(levels[2]).toBe(400);
  });
});

describe("spot strategies", () => {
  it("hold returns price change minus taker fee", () => {
    const get = run(candlesFromCloses(100, [120]), { takerFee: 0.001 });
    expect(get("spot-hold").finalEquity).toBeCloseTo((1000 / 100.1) * 120, 6);
  });

  it("grid profits from oscillation", () => {
    const get = run(candlesFromCloses(100, [110, 90, 110, 100]), {});
    const grid = get("spot-grid");
    const q = 1000 / 190; // 上格按开盘价 100 建仓，下格按挂单价 90 预留
    expect(grid.closeCount).toBe(3);
    expect(grid.realizedPnl).toBeCloseTo(30 * q, 6);
    // 期末价格回到 100，持仓成本也是 100，总收益 = 网格利润
    expect(grid.finalEquity).toBeCloseTo(1000 + 30 * q, 6);
    expect(grid.stats.unrealizedPnl).toBeCloseTo(0, 6);
  });

  it("follows the intrabar path open → low → high → close", () => {
    const candle: Candle = { time: T0, open: 100, high: 111, low: 89, close: 100, volume: 0 };
    const grid = run([candle], {})("spot-grid");
    expect(grid.trades.map((t) => `${t.action}:${t.side}@${t.price}`)).toEqual([
      "init:buy@100",
      "open:buy@90",
      "close:sell@100",
      "close:sell@110",
      "open:buy@100",
    ]);
    expect(grid.closeCount).toBe(2);
  });

  it("measures max drawdown from the running peak", () => {
    const get = run(candlesFromCloses(100, [120, 90, 130]), {});
    // 峰值 120 → 谷底 90，回撤 25%
    expect(get("spot-hold").maxDrawdown).toBeCloseTo(0.25, 9);
    expect(get("spot-grid").maxDrawdown).toBeLessThanOrEqual(1);
  });

  it("reports a flat position once every grid cell is closed", () => {
    // 价格涨破上限，所有格子卖出
    const grid = run(candlesFromCloses(100, [90, 105, 95, 120]), { gridCount: 7, lower: 83, upper: 117 })("spot-grid");
    expect(grid.finalPosition).toBe(0);
  });

  it("deducts maker fees on every grid fill", () => {
    const grid = run(candlesFromCloses(100, [110, 90, 110, 100]), { makerFee: 0.001 })("spot-grid");
    const feesFromTrades = grid.trades.reduce((sum, t) => sum + t.fee, 0);
    expect(grid.feesPaid).toBeCloseTo(feesFromTrades, 9);
    expect(grid.feesPaid).toBeGreaterThan(0);
    expect(grid.stats.pnl).toBeCloseTo(grid.realizedPnl + grid.stats.unrealizedPnl - grid.feesPaid, 9);
  });
});

describe("grid stops", () => {
  it("closes everything and stops when price falls to the lower stop", () => {
    const grid = run(candlesFromCloses(100, [80, 110]), { stopBelow: 85 })("spot-grid");
    expect(grid.trades.map((t) => `${t.action}:${t.side}@${t.price}`)).toEqual([
      "init:buy@100",
      "open:buy@90",
      "stop:sell@85",
    ]);
    expect(grid.finalPosition).toBe(0);
    expect(grid.metrics.stopPrice).toBe(85);
    // 停止平仓的亏损计入持仓盈亏，不计入网格利润
    expect(grid.realizedPnl).toBe(0);
    expect(grid.stats.unrealizedPnl).toBeLessThan(0);
  });

  it("stops a short grid when price rises to the upper stop", () => {
    const short = run(candlesFromCloses(100, [125, 90]), { market: "futures", stopAbove: 120 })("short-grid");
    expect(short.trades.map((t) => t.action)).toEqual(["init", "open", "stop"]);
    expect(short.trades.at(-1)?.price).toBe(120);
    expect(short.finalPosition).toBe(0);
  });

  it("scans a single strategy per cell", () => {
    const candles = candlesFromCloses(100, [110, 90, 110, 100]);
    const results = runGridSimulation(candles, [], HOUR, baseParams, "spot-grid");
    expect(results.map((r) => r.id)).toEqual(["spot-grid"]);
  });

  it("validates stop prices against the start price", () => {
    expect(validateGridParams({ ...baseParams, stopAbove: 95 }, 100)).toMatch(/高于/);
    expect(validateGridParams({ ...baseParams, stopBelow: 105 }, 100)).toMatch(/低于/);
    expect(validateGridParams({ ...baseParams, stopAbove: 120, stopBelow: 80 }, 100)).toBeNull();
  });
});

describe("futures strategies", () => {
  it("leveraged hold is liquidated on a large drop", () => {
    // 10x 多单理论强平价 ≈ 100 × 0.9 / 0.995 ≈ 90.45
    const hold = run(candlesFromCloses(100, [95, 90, 120]), { market: "futures", leverage: 10 })("futures-hold");
    expect(hold.liquidation).not.toBeNull();
    expect(hold.finalEquity).toBe(0);
    expect(hold.equity.at(-1)?.equity).toBe(0);
  });

  it("leveraged hold survives a small drop", () => {
    const hold = run(candlesFromCloses(100, [95]), { market: "futures", leverage: 10 })("futures-hold");
    expect(hold.liquidation).toBeNull();
    expect(hold.finalEquity).toBeCloseTo(1000 - 100 * 5, 6);
  });

  it("long pays and short grid receives positive funding", () => {
    const candles = candlesFromCloses(100, [100, 100, 100]);
    const funding: FundingRate[] = [
      { time: T0, rate: 0.001, markPrice: null }, // 开仓时刻，不收取
      { time: T0 + HOUR, rate: 0.001, markPrice: null },
    ];
    const get = run(candles, { market: "futures", leverage: 1, lower: 80, upper: 90 }, funding);
    const hold = get("futures-hold");
    expect(hold.fundingCount).toBe(1);
    expect(hold.fundingPaid).toBeCloseTo(10 * 100 * 0.001, 9);
    expect(hold.finalEquity).toBeCloseTo(999, 9);

    // 价格在区间上方，做空网格全部格子初始开空
    const short = get("short-grid");
    expect(short.finalPosition).toBeLessThan(0);
    expect(short.fundingPaid).toBeLessThan(0);
  });

  it("ignores funding when disabled", () => {
    const funding: FundingRate[] = [{ time: T0 + HOUR, rate: 0.01, markPrice: null }];
    const hold = run(candlesFromCloses(100, [100, 100]), { market: "futures", includeFunding: false }, funding)(
      "futures-hold",
    );
    expect(hold.fundingPaid).toBe(0);
  });

  it("short grid loses when price breaks above the range", () => {
    const short = run(candlesFromCloses(100, [120]), { market: "futures", leverage: 1 })("short-grid");
    const q = 1000 / 210; // 下格按开盘价 100 开空，上格按挂单价 110 预留
    expect(short.finalPosition).toBeCloseTo(-2 * q, 9);
    expect(short.finalEquity).toBeCloseTo(1000 - 30 * q, 6);
  });

  it("long grid mirrors spot grid without fees at 1x", () => {
    const candles = candlesFromCloses(100, [110, 90, 105, 95, 100]);
    const get = run(candles, { market: "futures", leverage: 1 });
    const spot = run(candles, {})("spot-grid");
    expect(get("long-grid").finalEquity).toBeCloseTo(spot.finalEquity, 6);
  });

  it("neutral grid opens no initial position", () => {
    const neutral = run(candlesFromCloses(100, [100]), { market: "futures" })("neutral-grid");
    expect(neutral.trades).toHaveLength(0);
    expect(neutral.finalEquity).toBe(1000);
  });
});

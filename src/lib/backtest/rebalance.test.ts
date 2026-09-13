import { describe, expect, it } from "vitest";
import {
  runRebalanceSimulation,
  simulatePortfolio,
  validateRebalanceParams,
  type PortfolioData,
  type RebalanceParams,
} from "./rebalance";
import { DAY, candlesFromCloses } from "./testUtils";

const params: RebalanceParams = {
  investment: 10000,
  assets: [
    { symbol: "AAAUSDT", weight: 0.5 },
    { symbol: "BBBUSDT", weight: 0.5 },
  ],
  period: "day",
  threshold: 0.05,
  fee: 0,
};

// A：100 → 200 → 100，B 不变
const data: PortfolioData = {
  symbols: ["AAAUSDT", "BBBUSDT"],
  assetCandles: [candlesFromCloses(100, [100, 200, 200, 100], DAY), candlesFromCloses(100, [100, 100, 100, 100], DAY)],
};

describe("portfolio rebalancing", () => {
  it("buy-and-hold ends where prices end", () => {
    const r = simulatePortfolio(data, params, "hold");
    expect(r.finalEquity).toBeCloseTo(10000, 9);
    expect(r.metrics.rebalances).toBe(0);
  });

  it("periodic rebalancing sells the winner and gains when prices mean-revert", () => {
    const r = simulatePortfolio(data, params, "periodic");
    // 第 3 天开盘 A=200：总值 15000，卖出 12.5 个 A、买入 25 个 B；A 回落到 100 后总值 11250
    expect(r.finalEquity).toBeCloseTo(11250, 9);
    expect(r.metrics.rebalances).toBe(1);
    expect(r.trades.filter((t) => t.action === "rebalance").map((t) => `${t.side}:${t.symbol}`)).toEqual([
      "sell:AAAUSDT",
      "buy:BBBUSDT",
    ]);
  });

  it("threshold rebalancing only trades when drift exceeds the threshold", () => {
    expect(simulatePortfolio(data, params, "threshold").finalEquity).toBeCloseTo(11250, 9);
    // A 权重最多偏离 16.7%，阈值 20% 时不触发
    expect(simulatePortfolio(data, { ...params, threshold: 0.2 }, "threshold").finalEquity).toBeCloseTo(10000, 9);
  });

  it("keeps the unallocated weight in USDT", () => {
    const single: PortfolioData = { symbols: ["AAAUSDT"], assetCandles: [data.assetCandles[0]] };
    const r = simulatePortfolio(single, { ...params, assets: [{ symbol: "AAAUSDT", weight: 0.5 }] }, "hold");
    expect(r.metrics.cash).toBeCloseTo(5000, 9);
    expect(r.finalEquity).toBeCloseTo(10000, 9);
  });

  it("charges fees on the initial allocation", () => {
    const r = simulatePortfolio(data, { ...params, fee: 0.001 }, "hold");
    expect(r.feesPaid).toBeCloseTo(10000 - 10000 / 1.001, 6);
    expect(r.finalEquity).toBeCloseTo(10000 / 1.001, 6);
  });

  it("adds single-asset holds as benchmarks", () => {
    const results = runRebalanceSimulation(data, DAY, params);
    expect(results.map((r) => r.id)).toEqual([
      "portfolio-hold",
      "rebalance-periodic",
      "rebalance-threshold",
      "hold-AAAUSDT",
      "hold-BBBUSDT",
    ]);
  });

  it("validates weights and symbols", () => {
    expect(validateRebalanceParams(params)).toBeNull();
    expect(
      validateRebalanceParams({
        ...params,
        assets: [
          { symbol: "AAAUSDT", weight: 0.7 },
          { symbol: "BBBUSDT", weight: 0.5 },
        ],
      }),
    ).toMatch(/100%/);
    expect(
      validateRebalanceParams({
        ...params,
        assets: [
          { symbol: "AAAUSDT", weight: 0.3 },
          { symbol: "AAAUSDT", weight: 0.3 },
        ],
      }),
    ).toMatch(/重复/);
  });
});

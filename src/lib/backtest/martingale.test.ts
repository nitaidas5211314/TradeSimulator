import { describe, expect, it } from "vitest";
import {
  martingaleLadder,
  runMartingaleSimulation,
  safetyDeviation,
  validateMartingaleParams,
  type MartingaleParams,
} from "./martingale";
import { HOUR, candlesFromCloses } from "./testUtils";

// 首单 100、加仓 200@98、加仓 400@96，合计 700
const params: MartingaleParams = {
  market: "spot",
  investment: 700,
  priceStep: 0.02,
  stepScale: 1,
  volumeScale: 2,
  maxSafetyOrders: 2,
  takeProfit: 0.01,
  stopLoss: 0,
  makerFee: 0,
  takerFee: 0,
  leverage: 1,
  maintenanceMarginRate: 0.005,
  includeFunding: false,
};

function run(closes: number[], overrides: Partial<MartingaleParams> = {}) {
  const results = runMartingaleSimulation(candlesFromCloses(100, closes), [], HOUR, { ...params, ...overrides });
  return (id: string) => {
    const r = results.find((x) => x.id === id);
    if (!r) throw new Error(`missing ${id}`);
    return r;
  };
}

describe("martingale ladder", () => {
  it("splits capital by volume scale", () => {
    const ladder = martingaleLadder(700, params);
    expect(ladder.baseQuote).toBeCloseTo(100, 9);
    expect(ladder.rows.map((r) => r.quote)).toEqual([100, 200, 400]);
    expect(ladder.rows.map((r) => r.deviation)).toEqual([0, 0.02, 0.04]);
  });

  it("scales price steps", () => {
    expect(safetyDeviation(3, 0.01, 2)).toBeCloseTo(0.07, 12);
  });

  it("rejects ladders deeper than 95%", () => {
    expect(validateMartingaleParams(params)).toBeNull();
    expect(validateMartingaleParams({ ...params, priceStep: 0.5 })).toMatch(/95%/);
  });
});

describe("spot martingale", () => {
  it("adds a safety order and takes profit on the rebound", () => {
    const bot = run([97, 100])("martingale-spot");
    expect(bot.trades.map((t) => t.action)).toEqual(["base", "safety", "takeProfit", "base"]);
    const qty = 1 + 200 / 98;
    expect(bot.trades[2].price).toBeCloseTo((300 / qty) * 1.01, 9);
    expect(bot.realizedPnl).toBeCloseTo(300 * 0.01, 9);
    expect(bot.metrics.cycles).toBe(1);
    expect(bot.metrics.maxSafetyUsed).toBe(1);
  });

  it("stops the bot after a stop loss", () => {
    const bot = run([80, 120], { stopLoss: 0.05 })("martingale-spot");
    expect(bot.trades.map((t) => t.action)).toEqual(["base", "safety", "safety", "stopLoss"]);
    expect(bot.realizedPnl).toBeCloseTo(-700 * 0.05, 9);
    expect(bot.finalPosition).toBe(0);
    expect(bot.metrics.stops).toBe(1);
  });

  it("never spends more than the investment", () => {
    const bot = run([50])("martingale-spot");
    expect(bot.trades).toHaveLength(3);
    expect(bot.finalEquity).toBeCloseTo((1 + 200 / 98 + 400 / 96) * 50, 6);
  });
});

describe("futures martingale", () => {
  it("short bot mirrors the long bot", () => {
    const short = run([103, 100], { market: "futures" })("martingale-short");
    expect(short.trades.map((t) => t.action)).toEqual(["base", "safety", "takeProfit", "base"]);
    expect(short.realizedPnl).toBeCloseTo(300 * 0.01, 9);
  });

  it("leveraged long bot is liquidated in a crash", () => {
    const long = run([60], { market: "futures", leverage: 10 })("martingale-long");
    expect(long.liquidation).not.toBeNull();
    expect(long.finalEquity).toBe(0);
  });
});

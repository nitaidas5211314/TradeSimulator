import { describe, expect, it } from "vitest";
import {
  advanceReplay,
  cancelReplayOrder,
  closeReplayPosition,
  createReplay,
  maxOrderQty,
  placeMarketOrder,
  placePendingOrder,
  replayStats,
  type ReplayConfig,
  type ReplayState,
} from "./replay";
import { HOUR, T0, candlesFromCloses } from "./testUtils";

const spot: ReplayConfig = {
  market: "spot",
  investment: 1000,
  leverage: 1,
  makerFee: 0,
  takerFee: 0,
  maintenanceMarginRate: 0.005,
  includeFunding: false,
};

// 收盘价：100、110、90、120
const candles = candlesFromCloses(100, [100, 110, 90, 120]);

function ok(result: { state: ReplayState; error: string | null }) {
  expect(result.error).toBeNull();
  return result.state;
}

describe("replay trading", () => {
  it("buys at market and realizes profit on the next bar", () => {
    let s = createReplay(spot, candles, [], 1);
    s = ok(placeMarketOrder(s, candles, "buy", 5));
    expect(s.cash).toBe(500);
    s = advanceReplay(s, candles, []);
    s = ok(closeReplayPosition(s, candles));
    expect(s.realizedPnl).toBeCloseTo(50, 9);
    expect(s.position).toBe(0);
    expect(replayStats(s, candles).winRate).toBe(1);
    expect(s.equity.map((p) => p.equity)).toEqual([1000, 1050]);
  });

  it("fills a limit buy when price dips to it", () => {
    let s = createReplay(spot, candles, [], 1);
    s = ok(placePendingOrder(s, "limit", "buy", 95, 5));
    s = advanceReplay(s, candles, []); // 100 → 110，未触发
    expect(s.position).toBe(0);
    s = advanceReplay(s, candles, []); // 110 → 90，触发 @95
    expect(s.position).toBe(5);
    expect(s.avgEntry).toBe(95);
    expect(s.orders).toHaveLength(0);
  });

  it("triggers a stop sell and records a loss", () => {
    let s = createReplay(spot, candles, [], 1);
    s = ok(placeMarketOrder(s, candles, "buy", 5));
    s = ok(placePendingOrder(s, "stop", "sell", 95, 5));
    s = advanceReplay(advanceReplay(s, candles, []), candles, []);
    expect(s.position).toBe(0);
    expect(s.realizedPnl).toBeCloseTo(-25, 9);
    expect(s.losses).toBe(1);
  });

  it("rejects spot orders beyond cash or holdings", () => {
    const s = createReplay(spot, candles, [], 1);
    expect(placeMarketOrder(s, candles, "buy", 20).error).toMatch(/USDT/);
    expect(placeMarketOrder(s, candles, "sell", 1).error).toMatch(/持仓/);
    expect(maxOrderQty(s, "buy", 100)).toBeCloseTo(10, 9);
  });

  it("cancels pending orders", () => {
    let s = createReplay(spot, candles, [], 1);
    s = ok(placePendingOrder(s, "limit", "buy", 95, 1));
    s = cancelReplayOrder(s, s.orders[0].id);
    expect(s.orders).toHaveLength(0);
  });

  it("liquidates an over-leveraged futures long", () => {
    const futures = { ...spot, market: "futures" as const, leverage: 10 };
    let s = createReplay(futures, candles, [], 1);
    s = ok(placeMarketOrder(s, candles, "buy", 100)); // 名义 10000 = 权益 × 10
    expect(placeMarketOrder(s, candles, "buy", 1).error).toMatch(/保证金/);
    s = advanceReplay(advanceReplay(s, candles, []), candles, []);
    expect(s.liquidation).not.toBeNull();
    expect(s.equity.at(-1)?.equity).toBe(0);
  });

  it("flips a futures position and resets the average entry", () => {
    const futures = { ...spot, market: "futures" as const, leverage: 5 };
    let s = createReplay(futures, candles, [], 1);
    s = ok(placeMarketOrder(s, candles, "sell", 5)); // 空 5 @100
    s = advanceReplay(s, candles, []); // 110
    s = ok(placeMarketOrder(s, candles, "buy", 8)); // 平空 5（亏 50），开多 3 @110
    expect(s.position).toBeCloseTo(3, 9);
    expect(s.avgEntry).toBe(110);
    expect(s.realizedPnl).toBeCloseTo(-50, 9);
  });

  it("charges funding on open futures positions", () => {
    const futures = { ...spot, market: "futures" as const, leverage: 2, includeFunding: true };
    let s = createReplay(futures, candles, [{ time: T0 + HOUR, rate: 0.001, markPrice: null }], 1);
    s = ok(placeMarketOrder(s, candles, "buy", 10));
    s = advanceReplay(s, candles, [{ time: T0 + HOUR, rate: 0.001, markPrice: null }]);
    expect(s.fundingPaid).toBeCloseTo(10 * 100 * 0.001, 9);
  });
});

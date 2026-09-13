import { describe, expect, it } from "vitest";
import type { FundingRate } from "@/lib/market/types";
import {
  arbitrageIndicators,
  runArbitrageSimulation,
  simulateArbitrage,
  validateArbitrageParams,
  type ArbitrageData,
  type ArbitrageParams,
} from "./arbitrage";
import { HOUR, T0, candlesFromCloses } from "./testUtils";

const params: ArbitrageParams = {
  investment: 10000,
  leverage: 1,
  rebalanceLeverage: 3,
  minFundingRate: 0,
  spotFee: 0,
  futuresFee: 0,
  maintenanceMarginRate: 0.005,
};

const STATIC = { rebalance: false, timing: false };
const REBALANCE = { rebalance: true, timing: false };

function data(closes: number[], options: { futuresCloses?: number[]; futuresStart?: number; funding?: FundingRate[] } = {}): ArbitrageData {
  const futuresCloses = options.futuresCloses ?? closes;
  return {
    spotCandles: candlesFromCloses(closes[0], closes),
    candles: candlesFromCloses(options.futuresStart ?? futuresCloses[0], futuresCloses),
    funding: options.funding ?? [],
  };
}

const rate = (hours: number, value: number): FundingRate => ({ time: T0 + hours * HOUR, rate: value, markPrice: null });

describe("funding arbitrage", () => {
  it("collects funding on a fully hedged position", () => {
    const r = simulateArbitrage(
      data([100, 100, 100], { funding: [rate(1, 0.001), rate(2, 0.001)] }),
      HOUR,
      params,
      STATIC,
    );
    // 1x：一半资金买现货、一半做保证金，数量 50
    expect(r.metrics.fundingIncome).toBeCloseTo(50 * 100 * 0.001 * 2, 9);
    expect(r.finalEquity).toBeCloseTo(10010, 9);
    expect(r.finalPosition).toBe(0);
  });

  it("is insensitive to price moves at 1x", () => {
    const r = simulateArbitrage(data([120, 150]), HOUR, params, STATIC);
    expect(r.liquidation).toBeNull();
    expect(r.finalEquity).toBeCloseTo(10000, 6);
  });

  it("liquidates the short leg in a rally without rebalancing, keeping the spot leg", () => {
    const r = simulateArbitrage(data([104, 108, 112, 116, 120, 125]), HOUR, { ...params, leverage: 5 }, STATIC);
    expect(r.liquidation).not.toBeNull();
    expect(r.finalPosition).toBeGreaterThan(0);
  });

  it("rebalancing avoids liquidation in the same rally", () => {
    const r = simulateArbitrage(
      data([104, 108, 112, 116, 120, 125]),
      HOUR,
      { ...params, leverage: 5, rebalanceLeverage: 8 },
      REBALANCE,
    );
    expect(r.liquidation).toBeNull();
    expect(r.metrics.rebalances).toBeGreaterThan(0);
    expect(Math.abs(r.finalPosition)).toBeLessThan(1e-9);
    expect(r.finalEquity).toBeCloseTo(10000, 6);
  });

  it("timing exits on negative funding and re-enters when it turns positive", () => {
    const r = simulateArbitrage(
      data([100, 100, 100, 100, 100], { funding: [rate(1, -0.001), rate(3, 0.001)] }),
      HOUR,
      { ...params, spotFee: 0.001, futuresFee: 0.0005 },
      { rebalance: true, timing: true },
    );
    expect(r.trades.map((t) => `${t.action}:${t.leg}`)).toEqual([
      "hedgeOpen:spot",
      "hedgeOpen:futures",
      "hedgeClose:spot",
      "hedgeClose:futures",
      "hedgeOpen:spot",
      "hedgeOpen:futures",
    ]);
    expect(r.metrics.entries).toBe(2);
    expect(r.metrics.exits).toBe(1);
  });

  it("earns the basis when futures premium converges", () => {
    const r = simulateArbitrage(data([100, 100], { futuresStart: 101, futuresCloses: [100, 100] }), HOUR, params, STATIC);
    const q = 10000 / (100 + 101);
    expect(r.metrics.priceBasisPnl).toBeCloseTo(q * 1, 6);
  });

  it("runs the hold benchmark and three arbitrage variants", () => {
    const results = runArbitrageSimulation(data([100, 100]), HOUR, params);
    expect(results.map((r) => r.id)).toEqual(["spot-hold", "arb-static", "arb-rebalance", "arb-timing"]);
  });

  it("annualizes the latest funding rate", () => {
    const { basis, fundingApr } = arbitrageIndicators(
      data([100, 100, 100], { futuresCloses: [101, 101, 101], funding: [rate(0, 0.0001), rate(8, 0.0001)] }),
    );
    expect(basis[0]).toBeCloseTo(0.01, 12);
    expect(fundingApr[0]).toBeCloseTo(0.0001 * 3 * 365, 12);
  });

  it("validates params", () => {
    expect(validateArbitrageParams({ ...params, leverage: 2, rebalanceLeverage: 4 })).toBeNull();
    expect(validateArbitrageParams({ ...params, leverage: 3, rebalanceLeverage: 3 })).not.toBeNull();
  });
});

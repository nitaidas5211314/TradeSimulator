import { describe, expect, it } from "vitest";
import { dcaSchedule, runDcaSimulation, validateDcaParams, type DcaParams } from "./dca";
import { DAY, T0, candlesFromCloses } from "./testUtils";

const params: DcaParams = { amount: 100, period: "day", maxMultiple: 3, makerFee: 0, takerFee: 0 };

function run(start: number, closes: number[], overrides: Partial<DcaParams> = {}) {
  const results = runDcaSimulation(candlesFromCloses(start, closes, DAY), DAY, { ...params, ...overrides });
  return (id: string) => {
    const r = results.find((x) => x.id === id);
    if (!r) throw new Error(`missing ${id}`);
    return r;
  };
}

describe("dcaSchedule", () => {
  it("steps by week", () => {
    expect(dcaSchedule(T0, T0 + 20 * DAY, "week")).toEqual([T0, T0 + 7 * DAY, T0 + 14 * DAY]);
  });

  it("clamps month-end dates", () => {
    const start = Date.UTC(2025, 0, 31);
    expect(dcaSchedule(start, Date.UTC(2025, 2, 31), "month")).toEqual([
      start,
      Date.UTC(2025, 1, 28),
      Date.UTC(2025, 2, 31),
    ]);
  });
});

describe("dca strategies", () => {
  it("buys a fixed amount each period", () => {
    const get = run(100, [100, 100, 100]);
    const fixed = get("dca-fixed");
    expect(fixed.metrics.buyCount).toBe(3);
    expect(fixed.metrics.invested).toBeCloseTo(300, 9);
    expect(fixed.finalEquity).toBeCloseTo(300, 9);
    expect(get("lump-sum").initialEquity).toBeCloseTo(300, 9);
  });

  it("value averaging buys more after a drop and skips after a rally", () => {
    // 开盘价依次为 100、50、200
    const get = run(100, [50, 200, 200]);
    const value = get("dca-value");
    // 第 1 期买 100@100；第 2 期目标 200、市值 50，买 150@50；第 3 期市值 800 超过目标，不买
    expect(value.metrics.buyCount).toBe(2);
    expect(value.metrics.invested).toBeCloseTo(250, 9);
    expect(value.finalPosition).toBeCloseTo(4, 9);
    expect(value.metrics.cash).toBeCloseTo(50, 9);
    expect(get("dca-fixed").finalPosition).toBeCloseTo(1 + 2 + 0.5, 9);
  });

  it("caps a single value-averaging buy", () => {
    const value = run(100, [50, 200, 200], { maxMultiple: 1 })("dca-value");
    expect(value.finalPosition).toBeCloseTo(1 + 2, 9);
  });

  it("includes taker fees in the planned capital", () => {
    const get = run(100, [100, 100, 100], { takerFee: 0.001 });
    const fixed = get("dca-fixed");
    expect(fixed.initialEquity).toBeCloseTo(300.3, 9);
    expect(fixed.metrics.invested).toBeCloseTo(300.3, 9);
    expect(fixed.finalEquity).toBeCloseTo(300, 9);
    expect(get("lump-sum").finalEquity).toBeCloseTo(300, 9);
  });

  it("validates params", () => {
    expect(validateDcaParams(params)).toBeNull();
    expect(validateDcaParams({ ...params, amount: 0 })).not.toBeNull();
    expect(validateDcaParams({ ...params, maxMultiple: 0.5 })).not.toBeNull();
  });
});

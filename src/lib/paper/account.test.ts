import { describe, expect, it } from "vitest";
import {
  MAX_TICKS,
  backfillBook,
  cancelPaperOrder,
  compactTicks,
  createBook,
  mergeTicks,
  placePaperOrder,
  createStrategy,
  markPaper,
  maxPaperQty,
  paperClose,
  paperReduce,
  applyFunding,
  paperStats,
  paperTrade,
  recordTick,
  strategySeries,
  type PaperResult,
  type PaperStrategy,
  type StrategyInput,
} from "./account";

const T0 = Date.UTC(2025, 0, 1);
const MINUTE = 60_000;

const input = (patch: Partial<StrategyInput> = {}): StrategyInput => ({
  name: "策略 A",
  color: "#f0b90b",
  note: "",
  investment: 1000,
  leverage: 1,
  feeRate: 0,
  makerFeeRate: 0,
  maintenanceMarginRate: 0.005,
  ...patch,
});

const spot = (patch?: Partial<StrategyInput>) => createStrategy("spot", input(patch), T0);
const futures = (patch?: Partial<StrategyInput>) => createStrategy("futures", input({ leverage: 5, ...patch }), T0);

function ok(result: PaperResult): PaperStrategy {
  expect(result.error).toBeNull();
  return result.strategy;
}

describe("paper spot trading", () => {
  it("建仓、减仓、平仓并结算已实现盈亏", () => {
    let s = spot();
    s = ok(paperTrade(s, "spot", "buy", 5, 100, T0 + MINUTE));
    expect(s.cash).toBe(500);
    expect(s.position).toBe(5);
    expect(s.avgEntry).toBe(100);
    expect(s.openedAt).toBe(T0 + MINUTE);
    expect(s.openPrice).toBe(100);
    expect(s.fills[0].action).toBe("open");

    s = ok(paperReduce(s, "spot", 0.5, 120, T0 + 2 * MINUTE));
    expect(s.position).toBe(2.5);
    expect(s.realizedPnl).toBeCloseTo(50, 9);
    expect(s.fills[1].action).toBe("reduce");

    s = ok(paperClose(s, "spot", 140, T0 + 3 * MINUTE));
    expect(s.position).toBe(0);
    expect(s.realizedPnl).toBeCloseTo(150, 9);
    expect(s.fills[2].action).toBe("close");

    const stats = paperStats(s, "spot", 140, T0 + 3 * MINUTE);
    expect(stats.equity).toBeCloseTo(1150, 9);
    expect(stats.returnPct).toBeCloseTo(0.15, 9);
    expect(stats.winRate).toBe(1);
    expect(stats.holdMs).toBe(2 * MINUTE);
    expect(stats.priceChangeSinceOpen).toBeCloseTo(0.4, 9);
  });

  it("加仓后按数量加权计算均价", () => {
    let s = spot();
    s = ok(paperTrade(s, "spot", "buy", 5, 100, T0));
    s = ok(paperTrade(s, "spot", "buy", 5, 80, T0 + MINUTE));
    expect(s.avgEntry).toBeCloseTo(90, 9);
    expect(s.fills[1].action).toBe("add");
  });

  it("扣除手续费并计入统计", () => {
    let s = spot({ feeRate: 0.001 });
    s = ok(paperTrade(s, "spot", "buy", 5, 100, T0));
    expect(s.feesPaid).toBeCloseTo(0.5, 9);
    expect(s.cash).toBeCloseTo(499.5, 9);
  });

  it("现货不能卖空或透支", () => {
    const s = spot();
    expect(paperTrade(s, "spot", "sell", 1, 100).error).toBe("现货卖出数量超过持仓");
    expect(paperTrade(s, "spot", "buy", 20, 100).error).toBe("可用 USDT 不足");
    expect(paperClose(s, "spot", 100).error).toBe("当前没有持仓");
    expect(maxPaperQty(s, "spot", "buy", 100)).toBeCloseTo(10, 9);
  });
});

describe("paper futures trading", () => {
  it("按杠杆限制仓位，可做空", () => {
    const s = futures();
    expect(maxPaperQty(s, "futures", "sell", 100)).toBeCloseTo(50, 9);
    expect(paperTrade(s, "futures", "sell", 60, 100).error).toBe("保证金不足（超过杠杆上限）");

    const short = ok(paperTrade(s, "futures", "sell", 30, 100, T0));
    expect(short.position).toBe(-30);
    expect(short.cash).toBe(4000);
    const stats = paperStats(short, "futures", 90, T0);
    expect(stats.unrealizedPnl).toBeCloseTo(300, 9);
    expect(stats.equity).toBeCloseTo(1300, 9);
    expect(stats.returnPct).toBeCloseTo(0.3, 9);
    // 做空强平价：权益恰好等于维持保证金
    const liq = stats.liquidationPrice as number;
    expect(short.cash - 30 * liq).toBeCloseTo(30 * liq * 0.005, 6);
  });

  it("反手时先平后开", () => {
    let s = futures();
    s = ok(paperTrade(s, "futures", "buy", 10, 100, T0));
    s = ok(paperTrade(s, "futures", "sell", 15, 120, T0 + MINUTE));
    expect(s.position).toBe(-5);
    expect(s.avgEntry).toBe(120);
    expect(s.realizedPnl).toBeCloseTo(200, 9);
    expect(s.fills[1].action).toBe("reverse");
  });

  it("权益低于维持保证金时强平", () => {
    let s = futures();
    s = ok(paperTrade(s, "futures", "buy", 50, 100, T0));
    const liq = paperStats(s, "futures", 100, T0).liquidationPrice as number;
    expect(liq).toBeCloseTo(4000 / (50 * 0.995), 6);

    s = markPaper(s, "futures", 90, T0 + MINUTE);
    expect(s.liquidatedAt).toBeNull();
    s = markPaper(s, "futures", liq - 1, T0 + 2 * MINUTE);
    expect(s.liquidatedAt).toBe(T0 + 2 * MINUTE);
    expect(s.position).toBe(0);
    expect(s.cash).toBe(0);
    expect(s.maxDrawdown).toBe(1);
    expect(s.fills[1].action).toBe("liquidation");
    expect(paperTrade(s, "futures", "buy", 1, 100).error).toBe("该策略已爆仓，请新建策略");
  });

  it("记录权益峰值与最大回撤", () => {
    let s = futures({ leverage: 2 });
    s = ok(paperTrade(s, "futures", "buy", 10, 100, T0));
    s = markPaper(s, "futures", 120, T0 + MINUTE);
    expect(s.peakEquity).toBeCloseTo(1200, 9);
    s = markPaper(s, "futures", 90, T0 + 2 * MINUTE);
    expect(s.maxDrawdown).toBeCloseTo(300 / 1200, 9);
  });
});

describe("paper book", () => {
  it("记录采样点并同步更新各策略", () => {
    let book = createBook("spot", "BTCUSDT", T0);
    book = { ...book, strategies: [spot()] };
    book = { ...book, strategies: [ok(paperTrade(book.strategies[0], "spot", "buy", 5, 100, T0))] };

    book = recordTick(book, 110, T0 + 2000);
    book = recordTick(book, 130, T0 + 4000);
    expect(book.ticks).toEqual([
      { time: T0 + 2000, price: 110 },
      { time: T0 + 4000, price: 130 },
    ]);
    expect(book.strategies[0].peakEquity).toBeCloseTo(1150, 9);

    // 间隔不足 1 秒时只更新最后一个点，保证时间戳唯一
    book = recordTick(book, 131, T0 + 4500);
    expect(book.ticks).toHaveLength(2);
    expect(book.ticks[1]).toEqual({ time: T0 + 4000, price: 131 });
  });

  it("采样点超上限时抽稀较早的部分", () => {
    const ticks = Array.from({ length: MAX_TICKS + 1 }, (_, i) => ({ time: T0 + i * 1000, price: 100 + i }));
    const compacted = compactTicks(ticks);
    expect(compacted.length).toBeLessThan(ticks.length);
    expect(compacted[0]).toEqual(ticks[0]);
    expect(compacted[compacted.length - 1]).toEqual(ticks[ticks.length - 1]);
    // 时间保持递增
    expect(compacted.every((t, i) => i === 0 || t.time > compacted[i - 1].time)).toBe(true);
  });
});

describe("strategySeries", () => {
  const ticks = [
    { time: T0, price: 100 },
    { time: T0 + MINUTE, price: 100 },
    { time: T0 + 2 * MINUTE, price: 120 },
    { time: T0 + 3 * MINUTE, price: 150 },
  ];

  it("重放成交，建仓之前为 null，结果与实时统计一致", () => {
    let s = spot();
    s = ok(paperTrade(s, "spot", "buy", 5, 100, T0 + MINUTE));
    s = ok(paperReduce(s, "spot", 0.5, 120, T0 + 2 * MINUTE));

    // 第三个采样点上减仓成交：已实现 50 + 持仓浮盈 50
    expect(strategySeries(s, ticks, "equity")).toEqual([null, 1000, 1100, 1175]);
    const returns = strategySeries(s, ticks, "returnPct");
    expect(returns[0]).toBeNull();
    expect(returns.slice(1) as number[]).toEqual([0, expect.closeTo(0.1, 9), expect.closeTo(0.175, 9)]);
    expect(strategySeries(s, ticks, "realizedPnl")).toEqual([null, 0, 50, 50]);
    expect(strategySeries(s, ticks, "positionValue")).toEqual([null, 500, 300, 375]);
    expect(strategySeries(s, ticks, "unrealizedPnl")).toEqual([null, 0, 50, 125]);

    const last = paperStats(s, "spot", 150, T0 + 3 * MINUTE);
    expect(strategySeries(s, ticks, "equity")[3]).toBeCloseTo(last.equity, 9);
    expect(last.equity).toBeCloseTo(1175, 9);
  });

  it("强平后权益归零", () => {
    let s = futures({ leverage: 10 });
    s = ok(paperTrade(s, "futures", "buy", 100, 100, T0 + MINUTE));
    s = markPaper(s, "futures", 90, T0 + 2 * MINUTE);
    expect(s.liquidatedAt).toBe(T0 + 2 * MINUTE);
    expect(strategySeries(s, ticks, "equity")).toEqual([null, 1000, 0, 0]);
  });
});

describe("paper pending orders", () => {
  it("限价买单在价格跌到触发价时成交，按挂单费率计费", () => {
    let s = spot({ makerFeeRate: 0.0002, feeRate: 0.001 });
    s = ok(placePaperOrder(s, "spot", "limit", "buy", 90, 5, T0));
    expect(s.orders).toHaveLength(1);

    s = markPaper(s, "spot", 95, T0 + MINUTE);
    expect(s.position).toBe(0);

    s = markPaper(s, "spot", 90, T0 + 2 * MINUTE);
    expect(s.position).toBe(5);
    expect(s.avgEntry).toBe(90);
    expect(s.orders).toHaveLength(0);
    expect(s.feesPaid).toBeCloseTo(5 * 90 * 0.0002, 9);
    expect(s.fills[0].maker).toBe(true);
    expect(s.notice).toContain("已成交");
    expect(s.openedAt).toBe(T0 + 2 * MINUTE);
  });

  it("限价单不会以优于市价的价格成交", () => {
    let s = spot();
    // 挂在现价之上的限价买单立即可成交，按现价而不是更高的挂单价成交
    s = ok(placePaperOrder(s, "spot", "limit", "buy", 120, 5, T0));
    s = markPaper(s, "spot", 100, T0 + MINUTE);
    expect(s.position).toBe(5);
    expect(s.avgEntry).toBe(100);
  });

  it("止损卖单在价格跌破触发价时市价成交", () => {
    let s = spot();
    s = ok(paperTrade(s, "spot", "buy", 5, 100, T0));
    s = ok(placePaperOrder(s, "spot", "stop", "sell", 90, 5, T0));
    s = markPaper(s, "spot", 95, T0 + MINUTE);
    expect(s.position).toBe(5);
    s = markPaper(s, "spot", 88, T0 + 2 * MINUTE);
    expect(s.position).toBe(0);
    expect(s.fills[1].maker).toBe(false);
    expect(s.realizedPnl).toBeCloseTo(-60, 9);
  });

  it("资金不足时挂单被取消并给出提示", () => {
    let s = spot();
    s = ok(placePaperOrder(s, "spot", "limit", "buy", 100, 10, T0));
    // 先把现金花掉，挂单触发时已经买不起
    s = ok(paperTrade(s, "spot", "buy", 9, 100, T0 + MINUTE));
    s = markPaper(s, "spot", 100, T0 + 2 * MINUTE);
    expect(s.position).toBe(9);
    expect(s.orders).toHaveLength(0);
    expect(s.notice).toContain("已取消");
  });

  it("可以撤单，爆仓时挂单全部撤销", () => {
    let s = spot();
    s = ok(placePaperOrder(s, "spot", "limit", "buy", 50, 5, T0));
    expect(cancelPaperOrder(s, s.orders[0].id).orders).toHaveLength(0);

    let f = futures({ leverage: 10 });
    f = ok(paperTrade(f, "futures", "buy", 100, 100, T0));
    f = ok(placePaperOrder(f, "futures", "limit", "sell", 200, 10, T0));
    f = markPaper(f, "futures", 90, T0 + MINUTE);
    expect(f.liquidatedAt).toBe(T0 + MINUTE);
    expect(f.orders).toHaveLength(0);
  });
});

describe("paper funding", () => {
  const funding = (nextTime: number, rate = 0.0001) => ({ rate, nextTime });

  it("到结算时刻按持仓结算资金费，多头费率为正时支付", () => {
    let book = createBook("futures", "BTCUSDT", T0);
    const s = ok(paperTrade(futures(), "futures", "buy", 10, 100, T0));
    book = { ...book, strategies: [s] };

    // 第一次采样只登记下次结算时间
    book = recordTick(book, 100, T0 + 1000, funding(T0 + 5000));
    expect(book.strategies[0].fundingPaid).toBe(0);

    // 时间未到，不结算
    book = recordTick(book, 101, T0 + 3000, funding(T0 + 5000));
    expect(book.strategies[0].fundingPaid).toBe(0);

    // 到点结算：10 × 100 × 0.0001
    book = recordTick(book, 100, T0 + 6000, funding(T0 + 6000 + 8 * 3600_000));
    expect(book.strategies[0].fundingPaid).toBeCloseTo(0.1, 9);
    expect(book.strategies[0].cashFlows).toHaveLength(1);

    // 下一期没到，不重复扣
    book = recordTick(book, 102, T0 + 9000, funding(T0 + 6000 + 8 * 3600_000));
    expect(book.strategies[0].fundingPaid).toBeCloseTo(0.1, 9);
  });

  it("资金费计入权益曲线", () => {
    let s = ok(paperTrade(futures(), "futures", "buy", 10, 100, T0));
    s = applyFunding(s, 0.001, 100, T0 + MINUTE);
    const ticks = [
      { time: T0, price: 100 },
      { time: T0 + 2 * MINUTE, price: 100 },
    ];
    // 建仓后权益 1000，扣除 10 × 100 × 0.001 = 1 的资金费
    expect(strategySeries(s, ticks, "equity")).toEqual([1000, 999]);
  });
});

describe("tick backfill", () => {
  it("合并K线收盘价补齐曲线，实时采样优先", () => {
    const live = [{ time: T0 + 2 * MINUTE, price: 111 }];
    const candles = [
      { time: T0, close: 100 },
      { time: T0 + MINUTE, close: 105 },
      { time: T0 + 2 * MINUTE, close: 110 },
    ];
    expect(mergeTicks(live, candles.map((c) => ({ time: c.time, price: c.close })))).toEqual([
      { time: T0, price: 100 },
      { time: T0 + MINUTE, price: 105 },
      { time: T0 + 2 * MINUTE, price: 111 },
    ]);
  });

  it("只回填策略建仓之后的部分", () => {
    const s = ok(paperTrade(spot(), "spot", "buy", 5, 100, T0 + MINUTE));
    const book = { ...createBook("spot", "BTCUSDT", T0), strategies: [s] };
    const filled = backfillBook(book, [
      { time: T0 - MINUTE, close: 90 },
      { time: T0 + MINUTE, close: 100 },
      { time: T0 + 2 * MINUTE, close: 120 },
    ]);
    expect(filled.ticks).toEqual([
      { time: T0 + MINUTE, price: 100 },
      { time: T0 + 2 * MINUTE, price: 120 },
    ]);
    expect(strategySeries(filled.strategies[0], filled.ticks, "equity")).toEqual([1000, 1100]);
  });

  it("没有策略时不回填", () => {
    const book = createBook("spot", "BTCUSDT", T0);
    expect(backfillBook(book, [{ time: T0, close: 100 }])).toBe(book);
  });
});

describe("满仓持有基准", () => {
  it("按建仓方向计算，做空时币价下跌为正收益", () => {
    const short = ok(paperTrade(futures({ leverage: 2 }), "futures", "sell", 10, 100, T0));
    expect(paperStats(short, "futures", 90, T0).holdReturn).toBeCloseTo(0.2, 9);
    const long = ok(paperTrade(futures({ leverage: 2 }), "futures", "buy", 10, 100, T0));
    expect(paperStats(long, "futures", 90, T0).holdReturn).toBeCloseTo(-0.2, 9);
  });
});

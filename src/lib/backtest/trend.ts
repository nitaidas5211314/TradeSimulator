import type { Candle, FundingRate, MarketType } from "@/lib/market/types";
import {
  HOLD_META,
  holdStrategy,
  runStrategies,
  validateCosts,
  type CostParams,
  type StrategyMeta,
  type StrategyResult,
} from "./common";
import type { Strategy, StrategyContext } from "./engine";
import { atr, donchian, ema, sma, type Series } from "./indicators";
import { toScanResult, type ScanResult } from "./scan";

// 趋势策略：K线收盘时计算目标仓位（信号），下一根K线开盘以市价调整仓位，避免使用未来数据。

export type MaType = "sma" | "ema";
export type Signal = 1 | 0 | -1;
export type TrendStrategyId = "ma-cross" | "donchian";

export const TREND_META = {
  "ma-cross": {
    name: "均线交叉",
    color: "#3b82f6",
    description: "快线在慢线之上时持有多单，跌破后平仓（允许做空时反手做空）；收盘出信号，下一根开盘成交",
  },
  donchian: {
    name: "通道突破（海龟）",
    color: "#22c55e",
    description: "收盘突破前 N 根最高价做多，跌破前 M 根最低价离场（允许做空时反向同理）；收盘出信号，下一根开盘成交",
  },
} satisfies Record<TrendStrategyId, StrategyMeta>;

export interface TrendParams extends CostParams {
  market: MarketType;
  investment: number;
  /** 仅合约有效 */
  allowShort: boolean;
  maType: MaType;
  fastPeriod: number;
  slowPeriod: number;
  entryPeriod: number;
  exitPeriod: number;
  atrPeriod: number;
  /** ATR 止损倍数，0 表示不止损 */
  atrStop: number;
}

export const MAX_PERIOD = 500;

export function validateTrendParams(p: TrendParams): string | null {
  if (!(p.investment > 0)) return "投入资金必须大于 0";
  const periods: [string, number][] = [
    ["快线周期", p.fastPeriod],
    ["慢线周期", p.slowPeriod],
    ["入场通道", p.entryPeriod],
    ["离场通道", p.exitPeriod],
    ["ATR 周期", p.atrPeriod],
  ];
  for (const [label, value] of periods) {
    if (!Number.isInteger(value) || value < 2 || value > MAX_PERIOD) return `${label}须为 2 ~ ${MAX_PERIOD} 的整数`;
  }
  if (p.fastPeriod >= p.slowPeriod) return "快线周期须小于慢线周期";
  if (!(p.atrStop >= 0 && p.atrStop <= 20)) return "ATR 止损倍数须在 0 ~ 20 之间";
  return validateCosts(p.market, p);
}

export function movingAverages(candles: Candle[], maType: MaType, fastPeriod: number, slowPeriod: number) {
  const closes = candles.map((c) => c.close);
  const average = maType === "ema" ? ema : sma;
  return { fast: average(closes, fastPeriod), slow: average(closes, slowPeriod) };
}

export function maCrossSignals(fast: Series, slow: Series, allowShort: boolean): Signal[] {
  return fast.map((f, i) => {
    const s = slow[i];
    if (f === null || s === null) return 0;
    return f > s ? 1 : allowShort ? -1 : 0;
  });
}

export function donchianSignals(
  candles: Candle[],
  entryPeriod: number,
  exitPeriod: number,
  allowShort: boolean,
): Signal[] {
  const entry = donchian(candles, entryPeriod);
  const exit = donchian(candles, exitPeriod);
  const signals: Signal[] = [];
  let position: Signal = 0;

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    const exitLower = exit.lower[i];
    const exitUpper = exit.upper[i];
    if (position === 1 && exitLower !== null && close < exitLower) position = 0;
    else if (position === -1 && exitUpper !== null && close > exitUpper) position = 0;

    if (position === 0) {
      const entryUpper = entry.upper[i];
      const entryLower = entry.lower[i];
      if (entryUpper !== null && close > entryUpper) position = 1;
      else if (allowShort && entryLower !== null && close < entryLower) position = -1;
    }
    signals.push(position);
  }
  return signals;
}

/**
 * 按信号全仓进出：signals[k] 为第 k 根收盘后的目标仓位，在第 k+1 根开盘执行。
 * ATR 止损：入场价 ∓ 倍数 × 上一根的 ATR；止损后需等信号变化才会重新入场。
 */
export function signalStrategy(
  signals: Signal[],
  atrValues: Series,
  atrStop: number,
  leverage: number,
  futures: boolean,
): Strategy {
  let side: Signal = 0;
  let entryPrice = 0;
  let entryTime = 0;
  let stop: number | null = null;
  let blocked: Signal | null = null;
  let roundTrips = 0;
  let wins = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let holdMs = 0;
  let stops = 0;
  let bars = 0;
  let barsInMarket = 0;

  const exit = (ctx: StrategyContext, price: number, action: "close" | "stopLoss") => {
    const qty = ctx.position;
    if (qty !== 0) {
      const profit = qty * (price - entryPrice);
      ctx.trade(-qty, price, { maker: false, action, profit });
      roundTrips++;
      holdMs += ctx.time - entryTime;
      if (profit > 0) {
        wins++;
        grossProfit += profit;
      } else {
        grossLoss -= profit;
      }
    }
    if (action === "stopLoss") {
      stops++;
      blocked = side;
    }
    side = 0;
    stop = null;
  };

  const enter = (ctx: StrategyContext, direction: 1 | -1, price: number, atrValue: number | null) => {
    const equity = ctx.equity(price);
    if (equity <= 0) return;
    const qty = futures
      ? (equity * leverage) / (price * (1 + ctx.takerFee * leverage))
      : ctx.cash / (price * (1 + ctx.takerFee));
    ctx.trade(direction * qty, price, { maker: false, action: "open" });
    side = direction;
    entryPrice = price;
    entryTime = ctx.time;
    stop = atrStop > 0 && atrValue !== null ? price - direction * atrStop * atrValue : null;
  };

  return {
    start() {},

    onBar(ctx, candle, k) {
      bars++;
      if (k > 0) {
        // 开盘跳空越过止损价时按开盘价止损
        if (side !== 0 && stop !== null && (side === 1 ? candle.open <= stop : candle.open >= stop)) {
          exit(ctx, candle.open, "stopLoss");
        }
        const desired = signals[k - 1];
        if (blocked !== null && desired !== blocked) blocked = null;
        if (blocked === null && desired !== side) {
          if (side !== 0) exit(ctx, candle.open, "close");
          if (desired !== 0) enter(ctx, desired, candle.open, atrValues[k - 1]);
        }
      }
      if (side !== 0) barsInMarket++;
    },

    onMove(ctx, a, b) {
      if (side === 0 || stop === null) return;
      const hit = side === 1 ? b < a && stop <= a && stop >= b : b > a && stop >= a && stop <= b;
      if (hit) exit(ctx, stop, "stopLoss");
    },

    metrics: () => ({
      roundTrips,
      winRate: roundTrips > 0 ? wins / roundTrips : null,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
      avgHoldHours: roundTrips > 0 ? holdMs / roundTrips / 3_600_000 : null,
      stops,
      exposure: bars > 0 ? barsInMarket / bars : null,
    }),
  };
}

/** 持有基准 + 均线交叉 + 通道突破；only 指定时只回测该策略 */
export function runTrendSimulation(
  candles: Candle[],
  funding: FundingRate[],
  intervalMs: number,
  p: TrendParams,
  only?: string,
): StrategyResult[] {
  const futures = p.market === "futures";
  const allowShort = futures && p.allowShort;
  const leverage = futures ? p.leverage : 1;
  const startPrice = candles[0].open;
  let atrCache: Series | null = null;
  const atrValues = () => (atrCache ??= atr(candles, p.atrPeriod));

  const factories: { id: string; meta: StrategyMeta; create: () => Strategy }[] = [
    futures
      ? {
          id: "futures-hold",
          meta: HOLD_META.futures,
          create: () => holdStrategy((p.investment * p.leverage) / startPrice),
        }
      : {
          id: "spot-hold",
          meta: HOLD_META.spot,
          create: () => holdStrategy(p.investment / (startPrice * (1 + p.takerFee))),
        },
    {
      id: "ma-cross",
      meta: TREND_META["ma-cross"],
      create: () => {
        const { fast, slow } = movingAverages(candles, p.maType, p.fastPeriod, p.slowPeriod);
        return signalStrategy(maCrossSignals(fast, slow, allowShort), atrValues(), p.atrStop, leverage, futures);
      },
    },
    {
      id: "donchian",
      meta: TREND_META.donchian,
      create: () =>
        signalStrategy(
          donchianSignals(candles, p.entryPeriod, p.exitPeriod, allowShort),
          atrValues(),
          p.atrStop,
          leverage,
          futures,
        ),
    },
  ];

  return runStrategies(
    { candles, funding, intervalMs, market: p.market, investment: p.investment, costs: p },
    factories.filter((f) => !only || f.id === only).map((f) => ({ id: f.id, meta: f.meta, strategy: f.create() })),
  );
}

export type TrendSample = "all" | "in" | "out";

/** 样本内：前 70% 的K线；样本外：后 30% */
export const IN_SAMPLE_RATIO = 0.7;

export function sampleCandles(candles: Candle[], sample: TrendSample): Candle[] {
  const cut = Math.floor(candles.length * IN_SAMPLE_RATIO);
  if (sample === "in") return candles.slice(0, cut);
  if (sample === "out") return candles.slice(cut);
  return candles;
}

export const TREND_SCAN_AXES = {
  "ma-cross": {
    rows: { label: "快线", values: [5, 10, 20, 30, 50] },
    cols: { label: "慢线", values: [20, 50, 100, 150, 200] },
  },
  donchian: {
    rows: { label: "入场通道", values: [10, 20, 40, 55, 80] },
    cols: { label: "离场通道", values: [5, 10, 20, 30] },
  },
} satisfies Record<TrendStrategyId, unknown>;

/** 参数扫描单元；快线不小于慢线时返回 null（不适用） */
export function runTrendScanCell(
  candles: Candle[],
  funding: FundingRate[],
  intervalMs: number,
  base: TrendParams,
  strategyId: TrendStrategyId,
  sample: TrendSample,
  row: number,
  col: number,
): ScanResult | null {
  if (strategyId === "ma-cross" && row >= col) return null;
  const params =
    strategyId === "ma-cross" ? { ...base, fastPeriod: row, slowPeriod: col } : { ...base, entryPeriod: row, exitPeriod: col };
  const sliced = sampleCandles(candles, sample);
  if (sliced.length < 2) return null;
  const [result] = runTrendSimulation(sliced, funding, intervalMs, params, strategyId);
  return toScanResult(result);
}

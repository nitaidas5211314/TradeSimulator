import type { Candle, FundingRate } from "@/lib/market/types";
import { HOLD_META, computeStats, holdStrategy, runStrategies, type StrategyMeta, type StrategyResult } from "./common";
import type { EngineResult, EquityPoint, Trade, TradeAction } from "./engine";

// 期现套利（资金费率套利）：现货买入 + 永续合约等量做空，价格涨跌基本对冲，收益主要来自资金费。
//
// 账户分两部分：
//   现货：spotQty × 现货价
//   合约：margin（保证金，含已实现盈亏和资金费）+ shortQty × (开空均价 − 合约价)
// 总权益 = 现金 + 现货市值 + 合约权益。价格上涨时合约权益减少，实际杠杆升高，可能被强平。

export const ARBITRAGE_META = {
  "arb-static": {
    name: "期现套利（不再平衡）",
    color: "#3b82f6",
    description: "开始时现货买入、永续合约等量做空，持有到结束赚取资金费；价格大涨时合约端可能被强平",
  },
  "arb-rebalance": {
    name: "期现套利（自动再平衡）",
    color: "#22c55e",
    description: "合约端实际杠杆达到触发值时，卖出部分现货补充保证金并同步减少空单",
  },
  "arb-timing": {
    name: "期现套利（费率择时）",
    color: "#a855f7",
    description: "上一期资金费率低于阈值时两边平仓离场，重新高于阈值时再入场（含自动再平衡）",
  },
} satisfies Record<string, StrategyMeta>;

export interface ArbitrageParams {
  investment: number;
  /** 合约端杠杆：保证金 = 空单名义价值 / 杠杆 */
  leverage: number;
  /** 合约端实际杠杆（名义价值 / 合约权益）达到该值时再平衡 */
  rebalanceLeverage: number;
  /** 费率择时：上一期资金费率低于该值时离场（小数） */
  minFundingRate: number;
  /** 两腿均为市价单，只用 Taker 费率 */
  spotFee: number;
  futuresFee: number;
  maintenanceMarginRate: number;
}

export function validateArbitrageParams(p: ArbitrageParams): string | null {
  if (!(p.investment > 0)) return "投入资金必须大于 0";
  if (!(p.leverage >= 1 && p.leverage <= 20)) return "合约杠杆须在 1 ~ 20 之间";
  if (!(p.rebalanceLeverage > p.leverage && p.rebalanceLeverage <= 100)) return "再平衡触发杠杆须大于合约杠杆（且不超过 100）";
  if (!(p.minFundingRate >= -0.01 && p.minFundingRate <= 0.01)) return "离场费率阈值须在 -1% ~ 1% 之间";
  if (!(p.spotFee >= 0 && p.spotFee < 0.1) || !(p.futuresFee >= 0 && p.futuresFee < 0.1)) return "手续费率不合法";
  if (!(p.maintenanceMarginRate >= 0 && p.maintenanceMarginRate < 0.5)) return "维持保证金率不合法";
  return null;
}

export interface ArbitrageData {
  /** 合约K线 */
  candles: Candle[];
  /** 与合约K线逐根对齐的现货K线 */
  spotCandles: Candle[];
  funding: FundingRate[];
}

export interface ArbitrageMode {
  rebalance: boolean;
  timing: boolean;
}

// 资金费时间戳可能带几毫秒偏差，给一分钟容差
const FUNDING_TOLERANCE_MS = 60_000;

/**
 * 逐根K线模拟：开盘时结算资金费并做择时决策，用合约最高价检查空单强平，
 * 收盘时检查是否需要再平衡。
 */
export function simulateArbitrage(
  data: ArbitrageData,
  intervalMs: number,
  p: ArbitrageParams,
  mode: ArbitrageMode,
): EngineResult {
  const { candles: futures, spotCandles: spot, funding } = data;
  const { leverage, spotFee: ts, futuresFee: tf } = p;

  let time = futures[0].time;
  let cash = p.investment;
  let spotQty = 0;
  let shortQty = 0;
  let shortEntry = 0;
  let margin = 0;
  let feesPaid = 0;
  let fundingPaid = 0;
  let fundingCount = 0;
  let realizedPnl = 0;
  let closeCount = 0;
  let rebalances = 0;
  let entries = 0;
  let exits = 0;
  let inMarketBars = 0;
  let lastRate: number | null = null;
  let liquidation: EngineResult["liquidation"] = null;
  let peak = p.investment;
  let maxDrawdown = 0;
  const trades: Trade[] = [];
  const equity: EquityPoint[] = [];

  const perpEquity = (price: number) => margin + shortQty * (shortEntry - price);
  const totalEquity = (s: number, f: number) => cash + spotQty * s + perpEquity(f);
  // 用 value 的资金同时建立等量现货与空单所需的数量
  const hedgeSize = (value: number, s: number, f: number) => value / (s * (1 + ts) + f / leverage + f * tf);

  const record = (
    leg: "spot" | "futures",
    side: "buy" | "sell",
    price: number,
    qty: number,
    fee: number,
    action: TradeAction,
    profit: number | null = null,
  ) => {
    trades.push({ time, side, price, qty, fee, action, profit, leg });
    feesPaid += fee;
  };

  const openHedge = (s: number, f: number) => {
    const q = hedgeSize(cash, s, f);
    const spotFee = q * s * ts;
    const perpFee = q * f * tf;
    spotQty = q;
    shortQty = q;
    shortEntry = f;
    margin = (q * f) / leverage;
    cash -= q * s + spotFee + margin + perpFee;
    record("spot", "buy", s, q, spotFee, "hedgeOpen");
    record("futures", "sell", f, q, perpFee, "hedgeOpen");
    entries++;
  };

  const closeHedge = (s: number, f: number) => {
    const spotFee = spotQty * s * ts;
    const pnl = shortQty * (shortEntry - f);
    const perpFee = shortQty * f * tf;
    cash += spotQty * s - spotFee + margin + pnl - perpFee;
    record("spot", "sell", s, spotQty, spotFee, "hedgeClose");
    record("futures", "buy", f, shortQty, perpFee, "hedgeClose", pnl);
    realizedPnl += pnl;
    closeCount++;
    spotQty = 0;
    shortQty = 0;
    shortEntry = 0;
    margin = 0;
    exits++;
  };

  const rebalance = (s: number, f: number) => {
    const target = hedgeSize(totalEquity(s, f), s, f);
    const d = shortQty - target;
    if (d <= 0) return;
    const spotFee = d * s * ts;
    const pnl = d * (shortEntry - f);
    const perpFee = d * f * tf;
    cash += d * s - spotFee;
    spotQty -= d;
    margin += pnl - perpFee;
    shortQty -= d;
    record("spot", "sell", s, d, spotFee, "rebalance");
    record("futures", "buy", f, d, perpFee, "rebalance", pnl);
    realizedPnl += pnl;
    closeCount++;
    // 用卖出现货得到的资金把合约端补回目标杠杆
    const transfer = Math.min(Math.max((shortQty * f) / leverage - perpEquity(f), 0), cash);
    margin += transfer;
    cash -= transfer;
    rebalances++;
  };

  const checkLiquidation = (high: number) => {
    if (shortQty === 0 || perpEquity(high) > p.maintenanceMarginRate * shortQty * high) return;
    record("futures", "buy", high, shortQty, 0, "liquidation");
    liquidation = { time, price: high };
    // 保证金归零，现货仍然持有，之后不再对冲
    margin = 0;
    shortQty = 0;
    shortEntry = 0;
  };

  const markEquity = (value: number) => {
    if (value > peak) peak = value;
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak);
  };

  let fundingIndex = 0;
  // 开仓时刻及之前的资金费不收取
  while (fundingIndex < funding.length && funding[fundingIndex].time <= futures[0].time + FUNDING_TOLERANCE_MS) {
    fundingIndex++;
  }
  const applyFunding = (until: number, fallbackPrice: number) => {
    while (fundingIndex < funding.length && funding[fundingIndex].time <= until) {
      const f = funding[fundingIndex++];
      lastRate = f.rate;
      if (shortQty === 0) continue;
      // 空头在费率为正时收取资金费
      const income = shortQty * (f.markPrice ?? fallbackPrice) * f.rate;
      margin += income;
      fundingPaid -= income;
      fundingCount++;
    }
  };

  for (let k = 0; k < futures.length; k++) {
    const fc = futures[k];
    const sc = spot[k];
    time = fc.time;

    if (k === 0) {
      openHedge(sc.open, fc.open);
    } else {
      applyFunding(fc.time + FUNDING_TOLERANCE_MS, fc.open);
      if (mode.timing && !liquidation && lastRate !== null) {
        if (shortQty > 0 && lastRate < p.minFundingRate) closeHedge(sc.open, fc.open);
        else if (shortQty === 0 && spotQty === 0 && lastRate >= p.minFundingRate) openHedge(sc.open, fc.open);
      }
    }

    checkLiquidation(fc.high);

    if (mode.rebalance && shortQty > 0) {
      const pe = perpEquity(fc.close);
      if (pe <= 0 || (shortQty * fc.close) / pe >= p.rebalanceLeverage) rebalance(sc.close, fc.close);
    }

    if (shortQty > 0) inMarketBars++;
    const value = totalEquity(sc.close, fc.close);
    markEquity(value);
    equity.push({ time: fc.time, equity: value });
  }

  const last = futures[futures.length - 1];
  const lastSpot = spot[spot.length - 1];
  applyFunding(last.time + intervalMs, last.close);
  const finalEquity = totalEquity(lastSpot.close, last.close);
  markEquity(finalEquity);
  equity[equity.length - 1] = { time: last.time, equity: finalEquity };

  const years = (last.time + intervalMs - futures[0].time) / (365 * 24 * 3600 * 1000);
  const fundingIncome = -fundingPaid;
  const net = spotQty - shortQty;

  return {
    equity,
    trades,
    initialEquity: p.investment,
    finalEquity,
    maxDrawdown,
    realizedPnl,
    closeCount,
    feesPaid,
    fundingPaid,
    fundingCount,
    liquidation,
    // 净敞口：两腿数量相等时为 0
    finalPosition: Math.abs(net) < Math.max(spotQty, shortQty) * 1e-9 ? 0 : net,
    metrics: {
      fundingIncome,
      fundingApr: years > 0 ? fundingIncome / p.investment / years : null,
      priceBasisPnl: finalEquity - p.investment - fundingIncome + feesPaid,
      rebalances,
      entries,
      exits,
      timeInMarket: inMarketBars / futures.length,
    },
  };
}

/** 现货持有 vs 三种期现套利 */
export function runArbitrageSimulation(data: ArbitrageData, intervalMs: number, p: ArbitrageParams): StrategyResult[] {
  const { candles, spotCandles } = data;
  const durationMs = candles[candles.length - 1].time + intervalMs - candles[0].time;

  const [spotHold] = runStrategies(
    {
      candles: spotCandles,
      funding: [],
      intervalMs,
      market: "spot",
      investment: p.investment,
      costs: { makerFee: p.spotFee, takerFee: p.spotFee, leverage: 1, maintenanceMarginRate: 0, includeFunding: false },
    },
    [
      {
        id: "spot-hold",
        meta: HOLD_META.spot,
        strategy: holdStrategy(p.investment / (spotCandles[0].open * (1 + p.spotFee))),
      },
    ],
  );

  const modes: [keyof typeof ARBITRAGE_META, ArbitrageMode][] = [
    ["arb-static", { rebalance: false, timing: false }],
    ["arb-rebalance", { rebalance: true, timing: false }],
    ["arb-timing", { rebalance: true, timing: true }],
  ];

  return [
    spotHold,
    ...modes.map(([id, mode]) => {
      const result = simulateArbitrage(data, intervalMs, p, mode);
      return { ...result, ...ARBITRAGE_META[id], id, stats: computeStats(result, durationMs) };
    }),
  ];
}

/** 每根K线的基差（合约收盘 / 现货收盘 − 1）与最近一期资金费率折算的年化 */
export function arbitrageIndicators(data: ArbitrageData) {
  const { candles, spotCandles, funding } = data;
  const basis: number[] = [];
  const fundingApr: (number | null)[] = [];
  let index = 0;
  let rate: number | null = null;
  let intervalHours = 8;

  for (let k = 0; k < candles.length; k++) {
    const t = candles[k].time;
    while (index < funding.length && funding[index].time <= t + FUNDING_TOLERANCE_MS) {
      if (index > 0) {
        intervalHours = Math.round((funding[index].time - funding[index - 1].time) / 3_600_000) || intervalHours;
      }
      rate = funding[index].rate;
      index++;
    }
    basis.push(candles[k].close / spotCandles[k].close - 1);
    fundingApr.push(rate === null ? null : rate * (24 / intervalHours) * 365);
  }
  return { basis, fundingApr };
}

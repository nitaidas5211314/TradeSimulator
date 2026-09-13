import type { Candle } from "@/lib/market/types";
import { computeStats, type StrategyMeta, type StrategyResult } from "./common";
import { DCA_PERIOD_LABEL, dcaSchedule, type DcaPeriod } from "./dca";
import type { EngineResult, EquityPoint, Trade, TradeAction } from "./engine";

// 多资产组合再平衡：按目标权重持有多个现货资产（剩余权重为 USDT 现金），
// 定期或在权重偏离超过阈值时，于K线开盘价调回目标权重。

export interface PortfolioAsset {
  symbol: string;
  /** 目标权重（小数） */
  weight: number;
}

export interface RebalanceParams {
  investment: number;
  assets: PortfolioAsset[];
  period: DcaPeriod;
  /** 任一资产实际权重与目标权重之差（绝对值）超过该值时再平衡 */
  threshold: number;
  /** 市价单 Taker 费率 */
  fee: number;
}

export interface PortfolioData {
  symbols: string[];
  /** 各资产逐根对齐的K线，顺序与 symbols 一致 */
  assetCandles: Candle[][];
}

export type RebalanceMode = "hold" | "periodic" | "threshold";

export const MAX_ASSETS = 5;

export const REBALANCE_META = {
  "portfolio-hold": { name: "买入持有组合", color: "#f0b90b", description: "开始时按目标权重买入，之后不再调整" },
  "rebalance-periodic": { name: "定期再平衡", color: "#3b82f6", description: "按固定周期把各资产调回目标权重" },
  "rebalance-threshold": {
    name: "阈值再平衡",
    color: "#22c55e",
    description: "任一资产权重偏离目标超过阈值时调回目标权重",
  },
} satisfies Record<string, StrategyMeta>;

const SINGLE_HOLD_COLORS = ["#a855f7", "#ef4444", "#14b8a6", "#f97316", "#ec4899"];

export function validateRebalanceParams(p: RebalanceParams): string | null {
  if (!(p.investment > 0)) return "投入资金必须大于 0";
  if (p.assets.length === 0 || p.assets.length > MAX_ASSETS) return `请设置 1 ~ ${MAX_ASSETS} 个资产`;
  const seen = new Set<string>();
  for (const asset of p.assets) {
    if (!/^[A-Z0-9]{2,30}$/.test(asset.symbol)) return `交易对「${asset.symbol || "空"}」格式不正确`;
    if (seen.has(asset.symbol)) return `交易对 ${asset.symbol} 重复`;
    seen.add(asset.symbol);
    if (!(asset.weight > 0)) return `${asset.symbol} 的权重必须大于 0`;
  }
  if (p.assets.reduce((sum, a) => sum + a.weight, 0) > 1 + 1e-9) return "资产权重合计不能超过 100%";
  if (!(p.threshold > 0 && p.threshold < 1)) return "偏离阈值须在 0% ~ 100% 之间";
  if (!(p.fee >= 0 && p.fee < 0.1)) return "手续费率不合法";
  return null;
}

export function simulatePortfolio(
  data: PortfolioData,
  p: RebalanceParams,
  mode: RebalanceMode,
): EngineResult {
  const { assetCandles } = data;
  const n = assetCandles[0].length;
  const weights = p.assets.map((a) => a.weight);
  const usdtWeight = Math.max(1 - weights.reduce((sum, w) => sum + w, 0), 0);
  const qty = new Array<number>(weights.length).fill(0);

  let cash = p.investment;
  let feesPaid = 0;
  let rebalances = 0;
  let turnover = 0;
  let peak = p.investment;
  let maxDrawdown = 0;
  const trades: Trade[] = [];
  const equity: EquityPoint[] = [];

  const valueAt = (prices: number[]) => qty.reduce((sum, q, i) => sum + q * prices[i], cash);

  /** 调回目标权重：先卖出超配资产，再用可用资金按比例买入低配资产 */
  const rebalanceTo = (prices: number[], time: number, action: TradeAction) => {
    const total = valueAt(prices);
    const minTrade = total * 1e-6;
    let traded = false;

    weights.forEach((w, i) => {
      const excess = qty[i] * prices[i] - total * w;
      if (excess <= minTrade) return;
      const fee = excess * p.fee;
      cash += excess - fee;
      qty[i] -= excess / prices[i];
      feesPaid += fee;
      if (action === "rebalance") turnover += excess;
      trades.push({ time, side: "sell", price: prices[i], qty: excess / prices[i], fee, action, profit: null, symbol: data.symbols[i] });
      traded = true;
    });

    const shortfalls = weights.map((w, i) => Math.max(total * w - qty[i] * prices[i], 0));
    const need = shortfalls.reduce((sum, s) => sum + s, 0) * (1 + p.fee);
    const budget = Math.max(cash - total * usdtWeight, 0);
    const scale = need > 0 ? Math.min(1, budget / need) : 0;

    shortfalls.forEach((shortfall, i) => {
      const spend = shortfall * scale;
      if (spend <= minTrade) return;
      const fee = spend * p.fee;
      cash -= spend + fee;
      qty[i] += spend / prices[i];
      feesPaid += fee;
      if (action === "rebalance") turnover += spend;
      trades.push({ time, side: "buy", price: prices[i], qty: spend / prices[i], fee, action, profit: null, symbol: data.symbols[i] });
      traded = true;
    });
    return traded;
  };

  const times = assetCandles[0].map((c) => c.time);
  // 第一期即开始时的建仓，跳过
  const schedule = mode === "periodic" ? dcaSchedule(times[0], times[n - 1], p.period) : [];
  let scheduleIndex = 1;

  for (let k = 0; k < n; k++) {
    const time = times[k];
    const opens = assetCandles.map((candles) => candles[k].open);

    if (k === 0) {
      rebalanceTo(opens, time, "init");
    } else if (mode === "periodic") {
      let due = false;
      while (scheduleIndex < schedule.length && schedule[scheduleIndex] <= time) {
        scheduleIndex++;
        due = true;
      }
      if (due && rebalanceTo(opens, time, "rebalance")) rebalances++;
    } else if (mode === "threshold") {
      const total = valueAt(opens);
      const drift = Math.max(...weights.map((w, i) => Math.abs((qty[i] * opens[i]) / total - w)));
      if (drift > p.threshold && rebalanceTo(opens, time, "rebalance")) rebalances++;
    }

    const value = valueAt(assetCandles.map((candles) => candles[k].close));
    if (value > peak) peak = value;
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak);
    equity.push({ time, equity: value });
  }

  return {
    equity,
    trades,
    initialEquity: p.investment,
    finalEquity: equity[equity.length - 1].equity,
    maxDrawdown,
    realizedPnl: 0,
    closeCount: 0,
    feesPaid,
    fundingPaid: 0,
    fundingCount: 0,
    liquidation: null,
    finalPosition: 0,
    metrics: { rebalances, turnover: turnover / p.investment, cash },
  };
}

/** 买入持有组合、定期再平衡、阈值再平衡，以及各资产单独持有作为参照 */
export function runRebalanceSimulation(data: PortfolioData, intervalMs: number, p: RebalanceParams): StrategyResult[] {
  const candles = data.assetCandles[0];
  const durationMs = candles[candles.length - 1].time + intervalMs - candles[0].time;
  const build = (id: string, meta: StrategyMeta, result: EngineResult): StrategyResult => ({
    ...result,
    ...meta,
    id,
    stats: computeStats(result, durationMs),
  });

  const results = [
    build("portfolio-hold", REBALANCE_META["portfolio-hold"], simulatePortfolio(data, p, "hold")),
    build(
      "rebalance-periodic",
      { ...REBALANCE_META["rebalance-periodic"], description: `${DCA_PERIOD_LABEL[p.period]}把各资产调回目标权重` },
      simulatePortfolio(data, p, "periodic"),
    ),
    build(
      "rebalance-threshold",
      {
        ...REBALANCE_META["rebalance-threshold"],
        description: `任一资产权重偏离目标超过 ${(p.threshold * 100).toFixed(1)}% 时调回目标权重`,
      },
      simulatePortfolio(data, p, "threshold"),
    ),
  ];

  data.symbols.forEach((symbol, i) => {
    results.push(
      build(
        `hold-${symbol}`,
        {
          name: `持有 ${symbol.replace(/USDT$/, "")}`,
          color: SINGLE_HOLD_COLORS[i % SINGLE_HOLD_COLORS.length],
          description: `全部资金买入 ${symbol} 并持有`,
        },
        simulatePortfolio(
          { symbols: [symbol], assetCandles: [data.assetCandles[i]] },
          { ...p, assets: [{ symbol, weight: 1 }] },
          "hold",
        ),
      ),
    );
  });

  return results;
}

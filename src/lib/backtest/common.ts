import type { Candle, FundingRate, MarketType } from "@/lib/market/types";
import { runBacktest, type EngineResult, type Strategy } from "./engine";

// 各策略页面共用：费用参数、持有基准、批量回测与指标计算

export interface StrategyMeta {
  name: string;
  color: string;
  description: string;
}

export const HOLD_META = {
  spot: { name: "现货持有", color: "#f0b90b", description: "开始时全部资金市价买入并持有到结束" },
  futures: { name: "合约买入持有", color: "#f59e0b", description: "按杠杆市价开多并持有到结束，计入资金费" },
} satisfies Record<MarketType, StrategyMeta>;

export interface CostParams {
  makerFee: number;
  takerFee: number;
  leverage: number;
  maintenanceMarginRate: number;
  includeFunding: boolean;
}

export interface StrategyStats {
  finalEquity: number;
  pnl: number;
  returnPct: number;
  annualizedReturn: number | null;
  maxDrawdown: number;
  feesPaid: number;
  fundingPaid: number;
  fundingCount: number;
  /** 未实现（持仓）盈亏 = 总盈亏 − 已实现盈亏 + 手续费 + 资金费 */
  unrealizedPnl: number;
  finalPosition: number;
  tradeCount: number;
}

export interface StrategyResult extends EngineResult, StrategyMeta {
  id: string;
  stats: StrategyStats;
}

export interface StrategyRun {
  id: string;
  meta: StrategyMeta;
  strategy: Strategy;
}

export function validateCosts(market: MarketType, c: CostParams): string | null {
  if (!(c.makerFee >= 0 && c.makerFee < 0.1) || !(c.takerFee >= 0 && c.takerFee < 0.1)) return "手续费率不合法";
  if (market === "futures") {
    if (!(c.leverage >= 1 && c.leverage <= 125)) return "杠杆倍数须在 1 ~ 125 之间";
    if (!(c.maintenanceMarginRate >= 0 && c.maintenanceMarginRate < 0.5)) return "维持保证金率不合法";
  }
  return null;
}

export function runStrategies(
  options: {
    candles: Candle[];
    funding: FundingRate[];
    intervalMs: number;
    market: MarketType;
    investment: number;
    costs: CostParams;
  },
  runs: StrategyRun[],
): StrategyResult[] {
  const { candles, intervalMs, market, investment, costs } = options;
  const futures = market === "futures";
  const durationMs = candles[candles.length - 1].time + intervalMs - candles[0].time;

  return runs.map(({ id, meta, strategy }) => {
    const result = runBacktest(
      {
        candles,
        intervalMs,
        investment,
        makerFee: costs.makerFee,
        takerFee: costs.takerFee,
        futures,
        maintenanceMarginRate: costs.maintenanceMarginRate,
        funding: futures && costs.includeFunding ? options.funding : [],
      },
      strategy,
    );
    return { ...result, ...meta, id, stats: computeStats(result, durationMs) };
  });
}

/** 开始时按开盘价市价买入（qty > 0）或卖出（qty < 0）并持有到结束 */
export function holdStrategy(qty: number): Strategy {
  let entry = 0;
  return {
    start(ctx, price) {
      entry = price;
      ctx.trade(qty, price, { maker: false, action: "init" });
    },
    metrics(ctx, lastPrice) {
      const invested = Math.abs(qty) * entry * (1 + ctx.takerFee);
      return {
        invested,
        buyCount: 1,
        avgCost: entry,
        holdingReturn: invested > 0 ? (qty * lastPrice - invested) / invested : null,
        cash: ctx.cash,
      };
    },
  };
}

export function computeStats(r: EngineResult, durationMs: number): StrategyStats {
  const pnl = r.finalEquity - r.initialEquity;
  const years = durationMs / (365 * 24 * 3600 * 1000);
  let annualizedReturn: number | null = null;
  // 少于 7 天的年化没有意义
  if (years >= 7 / 365) {
    annualizedReturn = r.finalEquity <= 0 ? -1 : Math.pow(r.finalEquity / r.initialEquity, 1 / years) - 1;
  }
  return {
    finalEquity: r.finalEquity,
    pnl,
    returnPct: pnl / r.initialEquity,
    annualizedReturn,
    maxDrawdown: r.maxDrawdown,
    feesPaid: r.feesPaid,
    fundingPaid: r.fundingPaid,
    fundingCount: r.fundingCount,
    unrealizedPnl: pnl - r.realizedPnl + r.feesPaid + r.fundingPaid,
    finalPosition: r.finalPosition,
    tradeCount: r.trades.length,
  };
}

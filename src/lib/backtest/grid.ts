import type { Candle, FundingRate, MarketType } from "@/lib/market/types";
import { runEngine, type EngineResult, type GridCells } from "./engine";

export type GridMode = "arithmetic" | "geometric";
export type GridDirection = "long" | "short" | "neutral";

export type StrategyId = "spot-hold" | "spot-grid" | "futures-hold" | "long-grid" | "short-grid" | "neutral-grid";

export const STRATEGY_META: Record<StrategyId, { name: string; color: string; description: string }> = {
  "spot-hold": { name: "现货持有", color: "#f0b90b", description: "开始时全部资金市价买入并持有到结束" },
  "spot-grid": { name: "现货网格", color: "#3b82f6", description: "区间内低买高卖，价格上方的格子初始买入底仓" },
  "futures-hold": { name: "合约买入持有", color: "#f59e0b", description: "按杠杆市价开多并持有到结束，计入资金费" },
  "long-grid": { name: "做多网格", color: "#22c55e", description: "只做多：价格上方格子初始开多，下跌逐格加多、上涨逐格平多" },
  "short-grid": { name: "做空网格", color: "#ef4444", description: "只做空：价格下方格子初始开空，上涨逐格加空、下跌逐格平空" },
  "neutral-grid": { name: "中性网格", color: "#a855f7", description: "不建初始仓：上方格子开空、下方格子开多" },
};

export interface SimulationParams {
  market: MarketType;
  investment: number;
  lower: number;
  upper: number;
  gridCount: number;
  gridMode: GridMode;
  leverage: number;
  makerFee: number;
  takerFee: number;
  maintenanceMarginRate: number;
  includeFunding: boolean;
}

export interface StrategyStats {
  finalEquity: number;
  pnl: number;
  returnPct: number;
  annualizedReturn: number | null;
  maxDrawdown: number;
  gridProfit: number;
  matchedCount: number;
  tradeCount: number;
  feesPaid: number;
  fundingPaid: number;
  fundingCount: number;
  /** 持仓浮动/方向性盈亏 = 总盈亏 - 网格利润 + 手续费 + 资金费 */
  positionPnl: number;
  finalPosition: number;
}

export interface StrategyResult extends EngineResult {
  id: StrategyId;
  name: string;
  color: string;
  description: string;
  stats: StrategyStats;
}

export const MAX_GRID_COUNT = 500;

export function buildGridLevels(lower: number, upper: number, count: number, mode: GridMode): number[] {
  const levels: number[] = [];
  if (mode === "arithmetic") {
    const step = (upper - lower) / count;
    for (let i = 0; i <= count; i++) levels.push(lower + step * i);
  } else {
    const ratio = Math.pow(upper / lower, 1 / count);
    for (let i = 0; i <= count; i++) levels.push(lower * Math.pow(ratio, i));
  }
  levels[count] = upper;
  return levels;
}

/** 每格扣除双边挂单手续费后的利润率区间 */
export function gridProfitRange(levels: number[], makerFee: number) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < levels.length - 1; i++) {
    const r = (levels[i + 1] - levels[i]) / levels[i] - 2 * makerFee;
    min = Math.min(min, r);
    max = Math.max(max, r);
  }
  return { min, max };
}

export function validateParams(p: SimulationParams): string | null {
  if (!(p.investment > 0)) return "投入资金必须大于 0";
  if (!(p.lower > 0) || !(p.upper > 0)) return "价格上下限必须大于 0";
  if (p.lower >= p.upper) return "价格下限必须小于价格上限";
  if (!Number.isInteger(p.gridCount) || p.gridCount < 2 || p.gridCount > MAX_GRID_COUNT) {
    return `网格数量须为 2 ~ ${MAX_GRID_COUNT} 的整数`;
  }
  if (p.makerFee < 0 || p.takerFee < 0 || p.makerFee >= 0.1 || p.takerFee >= 0.1) return "手续费率不合法";
  if (p.market === "futures") {
    if (!(p.leverage >= 1 && p.leverage <= 125)) return "杠杆倍数须在 1 ~ 125 之间";
    if (!(p.maintenanceMarginRate >= 0 && p.maintenanceMarginRate < 0.5)) return "维持保证金率不合法";
  }
  return null;
}

/**
 * 构建网格单元。每格数量相等（等量网格），数量由可用名义资金反推：
 * 已持仓格按开盘价计价，未持仓格按其挂单价计价。
 */
export function buildGridCells(
  levels: number[],
  direction: GridDirection,
  startPrice: number,
  notional: number,
  feeReserve: number,
): GridCells {
  const cellCount = levels.length - 1;
  const side: (1 | -1)[] = [];
  const open: boolean[] = [];
  let capitalPerUnit = 0;

  for (let i = 0; i < cellCount; i++) {
    const lo = levels[i];
    const hi = levels[i + 1];
    const mid = (lo + hi) / 2;
    // 离当前价最近的那一档不挂单，等价于用格子中点判断
    const cellSide: 1 | -1 = direction === "long" ? 1 : direction === "short" ? -1 : mid > startPrice ? -1 : 1;
    const isOpen = direction === "long" ? startPrice < mid : direction === "short" ? startPrice > mid : false;
    side.push(cellSide);
    open.push(isOpen);
    capitalPerUnit += isOpen ? startPrice : cellSide === 1 ? lo : hi;
  }

  return { levels, side, open, qtyPerCell: notional / (capitalPerUnit * (1 + feeReserve)) };
}

export function runGridSimulation(
  candles: Candle[],
  funding: FundingRate[],
  intervalMs: number,
  p: SimulationParams,
): StrategyResult[] {
  const startPrice = candles[0].open;
  const levels = buildGridLevels(p.lower, p.upper, p.gridCount, p.gridMode);
  const base = {
    candles,
    intervalMs,
    investment: p.investment,
    makerFee: p.makerFee,
    takerFee: p.takerFee,
    maintenanceMarginRate: p.maintenanceMarginRate,
    funding: p.includeFunding ? funding : [],
  };

  const runs: { id: StrategyId; result: EngineResult }[] = [];

  if (p.market === "spot") {
    const spot = { ...base, futures: false };
    runs.push({
      id: "spot-hold",
      result: runEngine({ ...spot, grid: null, holdQty: p.investment / (startPrice * (1 + p.takerFee)) }),
    });
    runs.push({
      id: "spot-grid",
      result: runEngine({
        ...spot,
        grid: buildGridCells(levels, "long", startPrice, p.investment, Math.max(p.makerFee, p.takerFee)),
        holdQty: 0,
      }),
    });
  } else {
    const fut = { ...base, futures: true };
    const notional = p.investment * p.leverage;
    runs.push({ id: "futures-hold", result: runEngine({ ...fut, grid: null, holdQty: notional / startPrice }) });
    const directions: [StrategyId, GridDirection][] = [
      ["long-grid", "long"],
      ["short-grid", "short"],
      ["neutral-grid", "neutral"],
    ];
    for (const [id, direction] of directions) {
      runs.push({
        id,
        result: runEngine({ ...fut, grid: buildGridCells(levels, direction, startPrice, notional, 0), holdQty: 0 }),
      });
    }
  }

  const durationMs = candles[candles.length - 1].time + intervalMs - candles[0].time;
  return runs.map(({ id, result }) => ({
    ...result,
    id,
    ...STRATEGY_META[id],
    stats: computeStats(result, durationMs),
  }));
}

function computeStats(r: EngineResult, durationMs: number): StrategyStats {
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
    gridProfit: r.gridProfit,
    matchedCount: r.matchedCount,
    tradeCount: r.trades.length,
    feesPaid: r.feesPaid,
    fundingPaid: r.fundingPaid,
    fundingCount: r.fundingCount,
    positionPnl: pnl - r.gridProfit + r.feesPaid + r.fundingPaid,
    finalPosition: r.finalPosition,
  };
}

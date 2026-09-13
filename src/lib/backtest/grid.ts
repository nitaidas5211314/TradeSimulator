import type { Candle, FundingRate, MarketType } from "@/lib/market/types";
import {
  HOLD_META,
  holdStrategy,
  runStrategies,
  validateCosts,
  type CostParams,
  type StrategyMeta,
  type StrategyResult,
  type StrategyRun,
} from "./common";
import type { Strategy, StrategyContext } from "./engine";
import { toScanResult, type ScanResult } from "./scan";

export type GridMode = "arithmetic" | "geometric";
export type GridDirection = "long" | "short" | "neutral";

export const GRID_META = {
  "spot-grid": { name: "现货网格", color: "#3b82f6", description: "区间内低买高卖，价格上方的格子初始买入底仓" },
  "long-grid": { name: "做多网格", color: "#22c55e", description: "只做多：价格上方格子初始开多，下跌逐格加多、上涨逐格平多" },
  "short-grid": { name: "做空网格", color: "#ef4444", description: "只做空：价格下方格子初始开空，上涨逐格加空、下跌逐格平空" },
  "neutral-grid": { name: "中性网格", color: "#a855f7", description: "不建初始仓：上方格子开空、下方格子开多" },
} satisfies Record<string, StrategyMeta>;

export interface GridParams extends CostParams {
  market: MarketType;
  investment: number;
  lower: number;
  upper: number;
  gridCount: number;
  gridMode: GridMode;
  /** 价格涨到该价时全部平仓并停止，null 表示不启用 */
  stopAbove: number | null;
  /** 价格跌到该价时全部平仓并停止，null 表示不启用 */
  stopBelow: number | null;
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

/** startPrice 为回测开盘价，提供时会检查停止价是否位于开盘价两侧 */
export function validateGridParams(p: GridParams, startPrice?: number): string | null {
  if (!(p.investment > 0)) return "投入资金必须大于 0";
  if (!(p.lower > 0) || !(p.upper > 0)) return "价格上下限必须大于 0";
  if (p.lower >= p.upper) return "价格下限必须小于价格上限";
  if (!Number.isInteger(p.gridCount) || p.gridCount < 2 || p.gridCount > MAX_GRID_COUNT) {
    return `网格数量须为 2 ~ ${MAX_GRID_COUNT} 的整数`;
  }
  if (p.stopAbove !== null && !(p.stopAbove > 0)) return "向上停止价必须大于 0";
  if (p.stopBelow !== null && !(p.stopBelow > 0)) return "向下停止价必须大于 0";
  if (startPrice !== undefined) {
    if (p.stopAbove !== null && p.stopAbove <= startPrice) return "向上停止价须高于回测开盘价";
    if (p.stopBelow !== null && p.stopBelow >= startPrice) return "向下停止价须低于回测开盘价";
  }
  return validateCosts(p.market, p);
}

/** 网格单元：价格区间 [levels[i], levels[i+1]] */
export interface GridCells {
  levels: number[];
  /** 1 = 多头格（低买高卖），-1 = 空头格（高卖低买） */
  side: (1 | -1)[];
  /** 初始是否已持仓（按开盘价市价建仓） */
  open: boolean[];
  qtyPerCell: number;
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

export interface GridStops {
  above: number | null;
  below: number | null;
}

const NO_STOPS: GridStops = { above: null, below: null };

export function gridStrategy(cells: GridCells, stops: GridStops = NO_STOPS): Strategy {
  const { levels, side, qtyPerCell: q } = cells;
  const cellCount = levels.length - 1;
  const open = cells.open.slice();
  const entry = new Array<number>(cellCount).fill(0);
  let stopTime: number | null = null;
  let stopPrice: number | null = null;

  const fill = (ctx: StrategyContext, cell: number, price: number) => {
    const opening = !open[cell];
    // 多头格开仓/空头格平仓是买入，反之是卖出
    const buy = (side[cell] === 1) === opening;
    let profit: number | undefined;
    if (opening) entry[cell] = price;
    else profit = side[cell] * q * (price - entry[cell]);
    open[cell] = opening;
    ctx.trade(buy ? q : -q, price, { maker: true, action: opening ? "open" : "close", profit });
  };

  // 下跌：触发买单（多头格开仓 @lo、空头格平仓 @lo）
  const matchDown = (ctx: StrategyContext, a: number, b: number) => {
    for (let j = upperBound(levels, a) - 1; j >= 0 && levels[j] >= b; j--) {
      if (j >= cellCount) continue;
      const isBuyOrder = side[j] === 1 ? !open[j] : open[j];
      if (isBuyOrder) fill(ctx, j, levels[j]);
    }
  };

  // 上涨：触发卖单（多头格平仓 @hi、空头格开仓 @hi）
  const matchUp = (ctx: StrategyContext, a: number, b: number) => {
    for (let j = lowerBound(levels, a); j < levels.length && levels[j] <= b; j++) {
      if (j === 0) continue;
      const cell = j - 1;
      const isSellOrder = side[cell] === 1 ? open[cell] : !open[cell];
      if (isSellOrder) fill(ctx, cell, levels[j]);
    }
  };

  const stopAll = (ctx: StrategyContext, price: number) => {
    stopTime = ctx.time;
    stopPrice = price;
    open.fill(false);
    // 停止时的方向性盈亏计入持仓盈亏，不计入网格利润
    if (ctx.position !== 0) ctx.trade(-ctx.position, price, { maker: false, action: "stop" });
  };

  return {
    start(ctx, price) {
      let initQty = 0;
      for (let i = 0; i < cellCount; i++) {
        if (!open[i]) continue;
        initQty += side[i] * q;
        entry[i] = price;
      }
      if (initQty !== 0) ctx.trade(initQty, price, { maker: false, action: "init" });
    },

    onMove(ctx, a, b) {
      if (stopTime !== null) return;
      if (b > a) {
        if (stops.above !== null && b >= stops.above) {
          const trigger = Math.max(a, stops.above);
          matchUp(ctx, a, trigger);
          stopAll(ctx, trigger);
        } else {
          matchUp(ctx, a, b);
        }
      } else if (stops.below !== null && b <= stops.below) {
        const trigger = Math.min(a, stops.below);
        matchDown(ctx, a, trigger);
        stopAll(ctx, trigger);
      } else {
        matchDown(ctx, a, b);
      }
    },

    metrics: () => ({ stopTime, stopPrice }),
  };
}

/** only 指定时只回测该策略（参数扫描用） */
export function runGridSimulation(
  candles: Candle[],
  funding: FundingRate[],
  intervalMs: number,
  p: GridParams,
  only?: string,
): StrategyResult[] {
  const startPrice = candles[0].open;
  const levels = buildGridLevels(p.lower, p.upper, p.gridCount, p.gridMode);
  const notional = p.investment * p.leverage;
  const stops: GridStops = { above: p.stopAbove, below: p.stopBelow };

  const runs: StrategyRun[] =
    p.market === "spot"
      ? [
          {
            id: "spot-hold",
            meta: HOLD_META.spot,
            strategy: holdStrategy(p.investment / (startPrice * (1 + p.takerFee))),
          },
          {
            id: "spot-grid",
            meta: GRID_META["spot-grid"],
            strategy: gridStrategy(
              buildGridCells(levels, "long", startPrice, p.investment, Math.max(p.makerFee, p.takerFee)),
              stops,
            ),
          },
        ]
      : [
          { id: "futures-hold", meta: HOLD_META.futures, strategy: holdStrategy(notional / startPrice) },
          ...(["long", "short", "neutral"] as const).map((direction) => ({
            id: `${direction}-grid`,
            meta: GRID_META[`${direction}-grid`],
            strategy: gridStrategy(buildGridCells(levels, direction, startPrice, notional, 0), stops),
          })),
        ];

  return runStrategies(
    { candles, funding, intervalMs, market: p.market, investment: p.investment, costs: p },
    only ? runs.filter((r) => r.id === only) : runs,
  );
}

export const GRID_SCAN_WIDTHS = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5];
export const GRID_SCAN_COUNTS = [5, 10, 15, 20, 30, 40, 60, 80, 100];

/** 参数扫描单元：以开盘价为中心 ±width 设置区间，gridCount 格 */
export function runGridScanCell(
  candles: Candle[],
  funding: FundingRate[],
  intervalMs: number,
  base: GridParams,
  strategyId: string,
  width: number,
  gridCount: number,
): ScanResult {
  const p0 = candles[0].open;
  const [result] = runGridSimulation(
    candles,
    funding,
    intervalMs,
    { ...base, lower: p0 * (1 - width), upper: p0 * (1 + width), gridCount },
    strategyId,
  );
  return toScanResult(result);
}

/** 第一个 >= value 的下标 */
function lowerBound(arr: number[], value: number) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 第一个 > value 的下标 */
function upperBound(arr: number[], value: number) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

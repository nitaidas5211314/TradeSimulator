import type { Candle, FundingRate } from "@/lib/market/types";

// 通用逐K线撮合引擎：同时支持现货与 U 本位线性合约。
//
// 记账方式：equity = cash + position × price
//   - 买入：cash -= qty × price，position += qty
//   - 卖出：cash += qty × price，position -= qty（合约可为负，即空头）
// 这一等式对现货和线性合约的盈亏计算完全一致，合约只是额外有资金费和强平。
//
// K线内价格路径假设（常用的 OHLC 近似）：
//   阳线：open → low → high → close
//   阴线：open → high → low → close

export type TradeAction = "open" | "close" | "init" | "liquidation";

export interface Trade {
  time: number;
  side: "buy" | "sell";
  price: number;
  qty: number;
  fee: number;
  action: TradeAction;
  /** 平仓时该格已实现盈亏（未扣手续费） */
  profit: number | null;
}

export interface EquityPoint {
  time: number;
  equity: number;
}

export interface EngineResult {
  equity: EquityPoint[];
  trades: Trade[];
  initialEquity: number;
  finalEquity: number;
  maxDrawdown: number;
  gridProfit: number;
  matchedCount: number;
  feesPaid: number;
  /** 净支付的资金费（正数为支出，负数为收入） */
  fundingPaid: number;
  fundingCount: number;
  liquidation: { time: number; price: number } | null;
  finalPosition: number;
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

export interface EngineInput {
  candles: Candle[];
  intervalMs: number;
  investment: number;
  makerFee: number;
  takerFee: number;
  /** 合约模式：启用资金费和强平 */
  futures: boolean;
  maintenanceMarginRate: number;
  funding: FundingRate[];
  grid: GridCells | null;
  /** 开始时额外市价建立的持仓（带符号），用于“持有”类策略 */
  holdQty: number;
}

// 资金费时间戳可能带几毫秒偏差，给一分钟容差
const FUNDING_TOLERANCE_MS = 60_000;

export function runEngine(input: EngineInput): EngineResult {
  const { candles, investment, makerFee, takerFee, futures, maintenanceMarginRate, grid } = input;
  if (candles.length === 0) throw new Error("没有K线数据");

  const levels = grid?.levels ?? [];
  const cellCount = grid ? levels.length - 1 : 0;
  const cellOpen = grid ? grid.open.slice() : [];
  const cellEntry = new Array<number>(cellCount).fill(0);
  const q = grid?.qtyPerCell ?? 0;

  let cash = investment;
  let position = 0;
  let feesPaid = 0;
  let fundingPaid = 0;
  let fundingCount = 0;
  let gridProfit = 0;
  let matchedCount = 0;
  let peak = investment;
  let maxDrawdown = 0;
  let liquidation: EngineResult["liquidation"] = null;

  const trades: Trade[] = [];
  const equity: EquityPoint[] = [];

  const first = candles[0];
  const startPrice = first.open;

  // 初始市价建仓：网格中已持仓的格子 + 持有策略仓位
  let initQty = input.holdQty;
  if (grid) {
    for (let i = 0; i < cellCount; i++) {
      if (cellOpen[i]) {
        initQty += grid.side[i] * q;
        cellEntry[i] = startPrice;
      }
    }
  }
  if (initQty !== 0) {
    const fee = Math.abs(initQty) * startPrice * takerFee;
    cash -= initQty * startPrice + fee;
    position += initQty;
    feesPaid += fee;
    trades.push({
      time: first.time,
      side: initQty > 0 ? "buy" : "sell",
      price: startPrice,
      qty: Math.abs(initQty),
      fee,
      action: "init",
      profit: null,
    });
  }

  const markEquity = (price: number) => {
    const eq = cash + position * price;
    if (eq > peak) peak = eq;
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - eq) / peak);
    return eq;
  };

  const checkLiquidation = (price: number, time: number) => {
    if (!futures || position === 0) return;
    const eq = cash + position * price;
    const maintenance = Math.abs(position) * price * maintenanceMarginRate;
    if (eq > maintenance) return;
    trades.push({
      time,
      side: position > 0 ? "sell" : "buy",
      price,
      qty: Math.abs(position),
      fee: 0,
      action: "liquidation",
      profit: null,
    });
    // 强平后剩余保证金归保险基金，视为全部损失
    liquidation = { time, price };
    cash = 0;
    position = 0;
    peak = Math.max(peak, 0);
    maxDrawdown = 1;
  };

  const fillCell = (cell: number, price: number, time: number) => {
    const side = grid!.side[cell];
    const opening = !cellOpen[cell];
    // 多头格开仓/空头格平仓是买入，反之是卖出
    const buy = (side === 1) === opening;
    const signedQty = buy ? q : -q;
    const fee = q * price * makerFee;
    cash -= signedQty * price + fee;
    position += signedQty;
    // 所有格子平仓后消除浮点残差，避免出现 "空 0"
    if (Math.abs(position) < q * 1e-9) position = 0;
    feesPaid += fee;

    let profit: number | null = null;
    if (opening) {
      cellEntry[cell] = price;
    } else {
      profit = side * q * (price - cellEntry[cell]);
      gridProfit += profit;
      matchedCount++;
    }
    cellOpen[cell] = opening;
    trades.push({ time, side: buy ? "buy" : "sell", price, qty: q, fee, action: opening ? "open" : "close", profit });
  };

  // 价格从 a 走到 b，触发途经的挂单
  const walk = (a: number, b: number, time: number) => {
    if (grid && b < a) {
      // 下跌：触发买单（多头格开仓 @lo、空头格平仓 @lo）
      for (let j = upperBound(levels, a) - 1; j >= 0 && levels[j] >= b; j--) {
        if (j >= cellCount) continue;
        const isBuyOrder = grid.side[j] === 1 ? !cellOpen[j] : cellOpen[j];
        if (isBuyOrder) fillCell(j, levels[j], time);
      }
    } else if (grid && b > a) {
      // 上涨：触发卖单（多头格平仓 @hi、空头格开仓 @hi）
      for (let j = lowerBound(levels, a); j < levels.length && levels[j] <= b; j++) {
        if (j === 0) continue;
        const cell = j - 1;
        const isSellOrder = grid.side[cell] === 1 ? cellOpen[cell] : !cellOpen[cell];
        if (isSellOrder) fillCell(cell, levels[j], time);
      }
    }
    markEquity(b);
    checkLiquidation(b, time);
  };

  const funding = futures ? input.funding : [];
  let fundingIndex = 0;
  // 开仓时刻及之前的资金费不收取
  while (fundingIndex < funding.length && funding[fundingIndex].time <= first.time + FUNDING_TOLERANCE_MS) {
    fundingIndex++;
  }

  const applyFunding = (until: number, fallbackPrice: number) => {
    while (fundingIndex < funding.length && funding[fundingIndex].time <= until) {
      const f = funding[fundingIndex++];
      if (liquidation || position === 0) continue;
      // 多头在费率为正时支付，空头收取
      const payment = position * (f.markPrice ?? fallbackPrice) * f.rate;
      cash -= payment;
      fundingPaid += payment;
      fundingCount++;
    }
  };

  markEquity(startPrice);

  for (let k = 0; k < candles.length; k++) {
    const c = candles[k];
    if (k > 0) {
      applyFunding(c.time + FUNDING_TOLERANCE_MS, c.open);
      if (!liquidation) {
        markEquity(c.open);
        checkLiquidation(c.open, c.time);
      }
    }
    if (!liquidation) {
      const path = c.close >= c.open ? [c.open, c.low, c.high, c.close] : [c.open, c.high, c.low, c.close];
      for (let s = 0; s < 3 && !liquidation; s++) walk(path[s], path[s + 1], c.time);
    }
    equity.push({ time: c.time, equity: liquidation ? 0 : cash + position * c.close });
  }

  const last = candles[candles.length - 1];
  if (!liquidation) {
    applyFunding(last.time + input.intervalMs, last.close);
    const eq = markEquity(last.close);
    equity[equity.length - 1] = { time: last.time, equity: eq };
  }

  return {
    equity,
    trades,
    initialEquity: investment,
    finalEquity: equity[equity.length - 1].equity,
    maxDrawdown,
    gridProfit,
    matchedCount,
    feesPaid,
    fundingPaid,
    fundingCount,
    liquidation,
    finalPosition: position,
  };
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

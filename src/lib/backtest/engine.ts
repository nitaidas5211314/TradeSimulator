import type { Candle, FundingRate } from "@/lib/market/types";

// 通用逐K线回测引擎：负责记账、手续费、资金费、强平、回撤与权益曲线；
// 何时下单、挂单如何撮合由策略（Strategy）决定。
//
// 记账方式：equity = cash + position × price
//   - 买入：cash -= qty × price，position += qty
//   - 卖出：cash += qty × price，position -= qty（合约可为负，即空头）
// 这一等式对现货和线性合约的盈亏计算完全一致，合约只是额外有资金费和强平。
//
// K线内价格路径假设（常用的 OHLC 近似）：
//   阳线：open → low → high → close
//   阴线：open → high → low → close
// 策略在 onMove 中撮合每段单调路径上被触发的挂单。

export type TradeAction =
  | "init"
  | "open"
  | "close"
  | "dca"
  | "base"
  | "safety"
  | "takeProfit"
  | "stopLoss"
  | "stop"
  | "hedgeOpen"
  | "hedgeClose"
  | "rebalance"
  | "liquidation";

export interface Trade {
  time: number;
  side: "buy" | "sell";
  price: number;
  qty: number;
  fee: number;
  action: TradeAction;
  /** 平仓时的已实现盈亏（未扣手续费） */
  profit: number | null;
  /** 多腿策略中该笔成交所在的市场 */
  leg?: "spot" | "futures";
}

export interface EquityPoint {
  time: number;
  equity: number;
}

export interface TradeOptions {
  /** 挂单成交按 Maker 计费，否则按 Taker */
  maker: boolean;
  action: TradeAction;
  /** 平仓时的已实现盈亏（未扣手续费） */
  profit?: number;
}

export interface StrategyContext {
  readonly time: number;
  readonly cash: number;
  readonly position: number;
  readonly makerFee: number;
  readonly takerFee: number;
  equity(price: number): number;
  /** 按指定价格成交：qty > 0 买入，qty < 0 卖出 */
  trade(qty: number, price: number, options: TradeOptions): void;
}

export type StrategyMetrics = Record<string, number | null>;

export interface Strategy {
  /** 回测开始时（第一根K线开盘价）调用 */
  start(ctx: StrategyContext, price: number): void;
  /** 每根K线开盘时调用，适合定时下单 */
  onBar?(ctx: StrategyContext, candle: Candle, index: number): void;
  /** 价格从 from 单调走到 to，策略撮合途经的挂单 */
  onMove?(ctx: StrategyContext, from: number, to: number): void;
  /** 回测结束时读取策略自定义指标 */
  metrics?(ctx: StrategyContext, lastPrice: number): StrategyMetrics;
}

export interface BacktestInput {
  candles: Candle[];
  intervalMs: number;
  investment: number;
  makerFee: number;
  takerFee: number;
  /** 合约模式：启用资金费和强平 */
  futures: boolean;
  maintenanceMarginRate: number;
  funding: FundingRate[];
}

export interface EngineResult {
  equity: EquityPoint[];
  trades: Trade[];
  initialEquity: number;
  finalEquity: number;
  maxDrawdown: number;
  /** 已实现盈亏合计（未扣手续费） */
  realizedPnl: number;
  /** 平仓（带已实现盈亏）的成交次数 */
  closeCount: number;
  feesPaid: number;
  /** 净支付的资金费（正数为支出，负数为收入） */
  fundingPaid: number;
  fundingCount: number;
  liquidation: { time: number; price: number } | null;
  finalPosition: number;
  metrics: StrategyMetrics;
}

// 资金费时间戳可能带几毫秒偏差，给一分钟容差
const FUNDING_TOLERANCE_MS = 60_000;

export function runBacktest(input: BacktestInput, strategy: Strategy): EngineResult {
  const { candles, investment, makerFee, takerFee, futures, maintenanceMarginRate } = input;
  if (candles.length === 0) throw new Error("没有K线数据");

  let time = candles[0].time;
  let cash = investment;
  let position = 0;
  let feesPaid = 0;
  let fundingPaid = 0;
  let fundingCount = 0;
  let realizedPnl = 0;
  let closeCount = 0;
  let peak = investment;
  let maxDrawdown = 0;
  let liquidation: EngineResult["liquidation"] = null;

  const trades: Trade[] = [];
  const equity: EquityPoint[] = [];

  const ctx: StrategyContext = {
    get time() {
      return time;
    },
    get cash() {
      return cash;
    },
    get position() {
      return position;
    },
    makerFee,
    takerFee,
    equity: (price) => cash + position * price,
    trade(qty, price, { maker, action, profit }) {
      if (liquidation || qty === 0) return;
      const fee = Math.abs(qty) * price * (maker ? makerFee : takerFee);
      cash -= qty * price + fee;
      position += qty;
      // 仓位平掉后消除浮点残差，避免出现 "空 0"
      if (Math.abs(position) < Math.abs(qty) * 1e-9) position = 0;
      feesPaid += fee;
      if (profit !== undefined) {
        realizedPnl += profit;
        closeCount++;
      }
      trades.push({ time, side: qty > 0 ? "buy" : "sell", price, qty: Math.abs(qty), fee, action, profit: profit ?? null });
    },
  };

  const markEquity = (price: number) => {
    const eq = cash + position * price;
    if (eq > peak) peak = eq;
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - eq) / peak);
    return eq;
  };

  const checkLiquidation = (price: number) => {
    if (!futures || position === 0) return;
    const eq = cash + position * price;
    if (eq > Math.abs(position) * price * maintenanceMarginRate) return;
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
    maxDrawdown = 1;
  };

  const first = candles[0];
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

  strategy.start(ctx, first.open);
  markEquity(first.open);

  for (let k = 0; k < candles.length; k++) {
    const c = candles[k];
    time = c.time;
    if (k > 0) applyFunding(c.time + FUNDING_TOLERANCE_MS, c.open);
    if (!liquidation) {
      strategy.onBar?.(ctx, c, k);
      markEquity(c.open);
      checkLiquidation(c.open);
    }
    if (!liquidation) {
      const path = c.close >= c.open ? [c.open, c.low, c.high, c.close] : [c.open, c.high, c.low, c.close];
      for (let s = 0; s < 3 && !liquidation; s++) {
        if (path[s + 1] !== path[s]) strategy.onMove?.(ctx, path[s], path[s + 1]);
        markEquity(path[s + 1]);
        checkLiquidation(path[s + 1]);
      }
    }
    equity.push({ time: c.time, equity: liquidation ? 0 : cash + position * c.close });
  }

  const last = candles[candles.length - 1];
  if (!liquidation) {
    applyFunding(last.time + input.intervalMs, last.close);
    equity[equity.length - 1] = { time: last.time, equity: markEquity(last.close) };
  }

  return {
    equity,
    trades,
    initialEquity: investment,
    finalEquity: equity[equity.length - 1].equity,
    maxDrawdown,
    realizedPnl,
    closeCount,
    feesPaid,
    fundingPaid,
    fundingCount,
    liquidation,
    finalPosition: position,
    metrics: strategy.metrics?.(ctx, last.close) ?? {},
  };
}

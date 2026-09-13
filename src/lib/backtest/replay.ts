import { fmtPrice } from "@/lib/format";
import type { Candle, FundingRate, MarketType } from "@/lib/market/types";
import type { EquityPoint, Trade } from "./engine";

// K线复盘手动交易：逐根推进行情，由用户下单。
// 记账方式与回测引擎一致：equity = cash + position × price。
// 状态为不可变对象，每次操作返回新状态，便于在 React 中使用。

export type ReplaySide = "buy" | "sell";
export type PendingOrderType = "limit" | "stop";

export interface ReplayOrder {
  id: number;
  type: PendingOrderType;
  side: ReplaySide;
  price: number;
  qty: number;
  /** 下单时所在K线下标 */
  createdAt: number;
}

export interface ReplayConfig {
  market: MarketType;
  investment: number;
  leverage: number;
  makerFee: number;
  takerFee: number;
  maintenanceMarginRate: number;
  includeFunding: boolean;
}

export interface ReplayState {
  config: ReplayConfig;
  /** 复盘起点（该K线收盘后开始交易） */
  startIndex: number;
  /** 当前已显示的最后一根K线 */
  cursor: number;
  cash: number;
  position: number;
  avgEntry: number;
  realizedPnl: number;
  feesPaid: number;
  fundingPaid: number;
  wins: number;
  losses: number;
  grossProfit: number;
  grossLoss: number;
  orders: ReplayOrder[];
  nextOrderId: number;
  trades: Trade[];
  equity: EquityPoint[];
  peak: number;
  maxDrawdown: number;
  fundingIndex: number;
  liquidation: { time: number; price: number } | null;
  /** 最近一次推进时挂单被取消等提示 */
  notice: string | null;
}

export interface ReplayResult {
  state: ReplayState;
  error: string | null;
}

// 资金费时间戳可能带几毫秒偏差，给一分钟容差
const FUNDING_TOLERANCE_MS = 60_000;
const EPS = 1e-9;

export function validateReplayConfig(c: ReplayConfig): string | null {
  if (!(c.investment > 0)) return "初始资金必须大于 0";
  if (!(c.makerFee >= 0 && c.makerFee < 0.1) || !(c.takerFee >= 0 && c.takerFee < 0.1)) return "手续费率不合法";
  if (c.market === "futures") {
    if (!(c.leverage >= 1 && c.leverage <= 125)) return "杠杆倍数须在 1 ~ 125 之间";
    if (!(c.maintenanceMarginRate >= 0 && c.maintenanceMarginRate < 0.5)) return "维持保证金率不合法";
  }
  return null;
}

export function createReplay(
  config: ReplayConfig,
  candles: Candle[],
  funding: FundingRate[],
  warmup: number,
): ReplayState {
  const startIndex = Math.min(Math.max(Math.floor(warmup) - 1, 0), candles.length - 1);
  const start = candles[startIndex];
  let fundingIndex = 0;
  while (fundingIndex < funding.length && funding[fundingIndex].time <= start.time + FUNDING_TOLERANCE_MS) {
    fundingIndex++;
  }
  return {
    config,
    startIndex,
    cursor: startIndex,
    cash: config.investment,
    position: 0,
    avgEntry: 0,
    realizedPnl: 0,
    feesPaid: 0,
    fundingPaid: 0,
    wins: 0,
    losses: 0,
    grossProfit: 0,
    grossLoss: 0,
    orders: [],
    nextOrderId: 1,
    trades: [],
    equity: [{ time: start.time, equity: config.investment }],
    peak: config.investment,
    maxDrawdown: 0,
    fundingIndex,
    liquidation: null,
    notice: null,
  };
}

const draft = (s: ReplayState): ReplayState => ({
  ...s,
  orders: [...s.orders],
  trades: [...s.trades],
  equity: [...s.equity],
});

const equityAt = (s: ReplayState, price: number) => s.cash + s.position * price;

/** 现货不能卖空、不能透支；合约增加仓位时名义价值不超过 权益 × 杠杆 */
function checkOrder(s: ReplayState, side: ReplaySide, qty: number, price: number): string | null {
  if (s.liquidation) return "账户已爆仓，请重新开始";
  if (!(qty > 0) || !(price > 0)) return "价格和数量必须大于 0";
  const { config } = s;
  if (config.market === "spot") {
    if (side === "sell" && qty > s.position * (1 + EPS)) return "现货卖出数量超过持仓";
    if (side === "buy" && qty * price * (1 + config.takerFee) > s.cash * (1 + EPS)) return "可用 USDT 不足";
    return null;
  }
  const next = s.position + (side === "buy" ? qty : -qty);
  if (
    Math.abs(next) > Math.abs(s.position) &&
    Math.abs(next) * price > Math.max(equityAt(s, price), 0) * config.leverage * (1 + EPS)
  ) {
    return "保证金不足（超过杠杆上限）";
  }
  return null;
}

/** 按指定价格计算某方向最多可下的数量 */
export function maxOrderQty(s: ReplayState, side: ReplaySide, price: number): number {
  if (s.liquidation || !(price > 0)) return 0;
  const { config } = s;
  if (config.market === "spot") {
    return side === "sell" ? Math.max(s.position, 0) : Math.max(s.cash, 0) / (price * (1 + config.takerFee));
  }
  const capacity = (Math.max(equityAt(s, price), 0) * config.leverage) / price;
  const sameDirection = s.position === 0 || (side === "buy") === s.position > 0;
  return Math.max(sameDirection ? capacity - Math.abs(s.position) : Math.abs(s.position) + capacity, 0);
}

function fill(d: ReplayState, side: ReplaySide, qty: number, price: number, maker: boolean, time: number) {
  const fee = qty * price * (maker ? d.config.makerFee : d.config.takerFee);
  const signed = side === "buy" ? qty : -qty;
  let profit: number | null = null;

  if (d.position !== 0 && Math.sign(d.position) !== Math.sign(signed)) {
    const closing = Math.min(qty, Math.abs(d.position));
    profit = closing * (price - d.avgEntry) * Math.sign(d.position);
    d.realizedPnl += profit;
    if (profit > 0) {
      d.wins++;
      d.grossProfit += profit;
    } else {
      d.losses++;
      d.grossLoss -= profit;
    }
    const flipped = qty > Math.abs(d.position) * (1 + EPS);
    d.position += signed;
    if (flipped) d.avgEntry = price;
  } else {
    const size = Math.abs(d.position);
    d.avgEntry = (size * d.avgEntry + qty * price) / (size + qty);
    d.position += signed;
  }
  // 全部平仓后消除浮点残差
  if (Math.abs(d.position) < qty * EPS) {
    d.position = 0;
    d.avgEntry = 0;
  }
  d.cash -= signed * price + fee;
  d.feesPaid += fee;
  d.trades.push({ time, side, price, qty, fee, action: profit === null ? "open" : "close", profit });
}

function markEquity(d: ReplayState, price: number) {
  const eq = equityAt(d, price);
  if (eq > d.peak) d.peak = eq;
  if (d.peak > 0) d.maxDrawdown = Math.max(d.maxDrawdown, (d.peak - eq) / d.peak);
}

function checkLiquidation(d: ReplayState, price: number, time: number) {
  if (d.config.market !== "futures" || d.position === 0 || d.liquidation) return;
  if (equityAt(d, price) > Math.abs(d.position) * price * d.config.maintenanceMarginRate) return;
  d.trades.push({
    time,
    side: d.position > 0 ? "sell" : "buy",
    price,
    qty: Math.abs(d.position),
    fee: 0,
    action: "liquidation",
    profit: null,
  });
  d.liquidation = { time, price };
  d.cash = 0;
  d.position = 0;
  d.avgEntry = 0;
  d.orders = [];
  d.maxDrawdown = 1;
}

/** 价格从 a 走到 b（a === b 表示开盘瞬间），撮合被触发的挂单 */
function triggerOrders(d: ReplayState, a: number, b: number, time: number) {
  const atOpen = a === b;
  const down = b < a;
  const triggered = (o: ReplayOrder) => {
    // 限价买与止损卖在价格下跌时触发，限价卖与止损买在价格上涨时触发
    const fallingTrigger = (o.type === "limit") === (o.side === "buy");
    if (atOpen) return fallingTrigger ? a <= o.price : a >= o.price;
    return fallingTrigger ? down && o.price <= a && o.price >= b : !down && o.price >= a && o.price <= b;
  };

  const hits = d.orders.filter(triggered);
  if (hits.length === 0) return;
  hits.sort((x, y) => (down ? y.price - x.price : x.price - y.price));
  d.orders = d.orders.filter((o) => !hits.includes(o));

  for (const o of hits) {
    if (d.liquidation) break;
    // 限价单按挂单价成交；止损单按触发价市价成交，开盘跳空时按开盘价
    const price = o.type === "stop" && atOpen ? a : o.price;
    const error = checkOrder(d, o.side, o.qty, price);
    if (error) {
      d.notice = `${o.side === "buy" ? "买入" : "卖出"}${o.type === "limit" ? "限价" : "止损"}单 @${fmtPrice(o.price)} 已取消：${error}`;
      continue;
    }
    fill(d, o.side, o.qty, price, o.type === "limit", time);
  }
}

/** 显示下一根K线：结算资金费，按 开→低→高→收（阴线 开→高→低→收）撮合挂单并检查强平 */
export function advanceReplay(s: ReplayState, candles: Candle[], funding: FundingRate[]): ReplayState {
  if (s.cursor >= candles.length - 1) return s;
  const d = draft(s);
  d.notice = null;
  d.cursor++;
  const c = candles[d.cursor];

  if (d.config.market === "futures" && d.config.includeFunding) {
    while (d.fundingIndex < funding.length && funding[d.fundingIndex].time <= c.time + FUNDING_TOLERANCE_MS) {
      const f = funding[d.fundingIndex++];
      if (d.position === 0 || d.liquidation) continue;
      const payment = d.position * (f.markPrice ?? c.open) * f.rate;
      d.cash -= payment;
      d.fundingPaid += payment;
    }
  }

  if (!d.liquidation) {
    triggerOrders(d, c.open, c.open, c.time);
    markEquity(d, c.open);
    checkLiquidation(d, c.open, c.time);
    const path = c.close >= c.open ? [c.open, c.low, c.high, c.close] : [c.open, c.high, c.low, c.close];
    for (let i = 0; i < 3 && !d.liquidation; i++) {
      if (path[i] !== path[i + 1]) triggerOrders(d, path[i], path[i + 1], c.time);
      markEquity(d, path[i + 1]);
      checkLiquidation(d, path[i + 1], c.time);
    }
  }

  d.equity.push({ time: c.time, equity: equityAt(d, c.close) });
  return d;
}

/** 以当前K线收盘价市价成交 */
export function placeMarketOrder(s: ReplayState, candles: Candle[], side: ReplaySide, qty: number): ReplayResult {
  const candle = candles[s.cursor];
  const error = checkOrder(s, side, qty, candle.close);
  if (error) return { state: s, error };
  const d = draft(s);
  d.notice = null;
  fill(d, side, qty, candle.close, false, candle.time);
  markEquity(d, candle.close);
  d.equity[d.equity.length - 1] = { time: candle.time, equity: equityAt(d, candle.close) };
  return { state: d, error: null };
}

/** 挂限价单或止损单，从下一根K线开始撮合 */
export function placePendingOrder(
  s: ReplayState,
  type: PendingOrderType,
  side: ReplaySide,
  price: number,
  qty: number,
): ReplayResult {
  const error = checkOrder(s, side, qty, price);
  if (error) return { state: s, error };
  return {
    state: {
      ...s,
      orders: [...s.orders, { id: s.nextOrderId, type, side, price, qty, createdAt: s.cursor }],
      nextOrderId: s.nextOrderId + 1,
      notice: null,
    },
    error: null,
  };
}

export function cancelReplayOrder(s: ReplayState, id: number): ReplayState {
  return { ...s, orders: s.orders.filter((o) => o.id !== id) };
}

export function closeReplayPosition(s: ReplayState, candles: Candle[]): ReplayResult {
  if (s.position === 0) return { state: s, error: "当前没有持仓" };
  return placeMarketOrder(s, candles, s.position > 0 ? "sell" : "buy", Math.abs(s.position));
}

export function replayStats(s: ReplayState, candles: Candle[]) {
  const price = candles[s.cursor].close;
  const equity = equityAt(s, price);
  const closed = s.wins + s.losses;
  return {
    price,
    equity,
    returnPct: equity / s.config.investment - 1,
    unrealizedPnl: s.position * (price - s.avgEntry),
    holdReturn: price / candles[s.startIndex].close - 1,
    closedCount: closed,
    winRate: closed > 0 ? s.wins / closed : null,
    profitFactor: s.grossLoss > 0 ? s.grossProfit / s.grossLoss : null,
    progress: (s.cursor - s.startIndex) / Math.max(candles.length - 1 - s.startIndex, 1),
  };
}

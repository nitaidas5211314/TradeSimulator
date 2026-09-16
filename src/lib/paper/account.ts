import { fmtPrice } from "@/lib/format";
import type { MarketType } from "@/lib/market/types";

// 模拟盘：使用 Binance 实时价格，对同一币种并行运行多个策略。
// 记账方式与回测引擎一致：equity = cash + position × price。
// 状态为不可变对象，每次操作返回新对象，便于在 React 中使用。

export type PaperSide = "buy" | "sell";
/** 由成交前后的仓位自动判定 */
export type PaperAction = "open" | "add" | "reduce" | "close" | "reverse" | "liquidation";
export type PaperOrderType = "limit" | "stop";

export interface PaperFill {
  time: number;
  side: PaperSide;
  price: number;
  qty: number;
  fee: number;
  action: PaperAction;
  /** 平仓部分的已实现盈亏，纯开仓为 null */
  profit: number | null;
  /** 由挂单成交 */
  maker?: boolean;
}

export interface PaperOrder {
  id: number;
  type: PaperOrderType;
  side: PaperSide;
  price: number;
  qty: number;
  createdAt: number;
}

/** 成交之外的现金变动（目前只有资金费） */
export interface PaperCashFlow {
  time: number;
  /** 签名金额，负数为支出 */
  amount: number;
  kind: "funding";
}

/** 与成交相关的账目，策略与曲线重放共用 */
export interface PaperLedger {
  cash: number;
  position: number;
  avgEntry: number;
  realizedPnl: number;
  feesPaid: number;
  wins: number;
  losses: number;
  grossProfit: number;
  grossLoss: number;
}

export interface PaperStrategy extends PaperLedger {
  id: string;
  name: string;
  color: string;
  /** 策略思路备注 */
  note: string;
  investment: number;
  /** 现货恒为 1 */
  leverage: number;
  /** 市价单与止损单费率 */
  feeRate: number;
  /** 限价挂单成交费率 */
  makerFeeRate: number;
  maintenanceMarginRate: number;
  createdAt: number;
  /** 首次建仓时间与价格，用于对比各策略建仓后的表现 */
  openedAt: number | null;
  openPrice: number | null;
  /** 首次建仓方向：1 做多，-1 做空 */
  openDirection: number;
  peakEquity: number;
  maxDrawdown: number;
  liquidatedAt: number | null;
  fundingPaid: number;
  orders: PaperOrder[];
  nextOrderId: number;
  fills: PaperFill[];
  cashFlows: PaperCashFlow[];
  /** 挂单成交、取消等提示，操作后清空 */
  notice: string | null;
}

/** 实时价格采样点 */
export interface PaperTick {
  time: number;
  price: number;
}

/** 当前资金费率与下次结算时间 */
export interface FundingInfo {
  rate: number;
  nextTime: number;
}

/** 一个币种的模拟盘：多个策略共用同一价格流 */
export interface PaperBook {
  market: MarketType;
  symbol: string;
  createdAt: number;
  updatedAt: number;
  strategies: PaperStrategy[];
  ticks: PaperTick[];
  /** 等待结算的资金费，时间到了在下一个采样点结算 */
  pendingFunding: FundingInfo | null;
}

export const STRATEGY_COLORS = [
  "#f0b90b",
  "#3b82f6",
  "#0ecb81",
  "#f6465d",
  "#a855f7",
  "#06b6d4",
  "#fb923c",
  "#ec4899",
];

/** 采样点上限，超出后对较早的部分隔点抽稀 */
export const MAX_TICKS = 1500;
/** 两个采样点之间的最小间隔，保证时间戳（秒）唯一 */
const MIN_TICK_GAP_MS = 1000;
const EPS = 1e-9;

export const bookKey = (market: MarketType, symbol: string) => `${market}|${symbol}`;

export function createBook(market: MarketType, symbol: string, now = Date.now()): PaperBook {
  return { market, symbol, createdAt: now, updatedAt: now, strategies: [], ticks: [], pendingFunding: null };
}

export interface StrategyInput {
  name: string;
  color: string;
  note: string;
  investment: number;
  leverage: number;
  /** 小数，0.0005 = 0.05% */
  feeRate: number;
  makerFeeRate: number;
  maintenanceMarginRate: number;
}

export function validateStrategy(market: MarketType, input: StrategyInput): string | null {
  if (!input.name.trim()) return "请输入策略名称";
  if (!(input.investment > 0)) return "初始资金必须大于 0";
  if (!(input.feeRate >= 0 && input.feeRate < 0.1) || !(input.makerFeeRate >= 0 && input.makerFeeRate < 0.1)) {
    return "手续费率不合法";
  }
  if (market === "futures") {
    if (!(input.leverage >= 1 && input.leverage <= 125)) return "杠杆倍数须在 1 ~ 125 之间";
    if (!(input.maintenanceMarginRate >= 0 && input.maintenanceMarginRate < 0.5)) return "维持保证金率不合法";
  }
  return null;
}

export function createStrategy(market: MarketType, input: StrategyInput, now = Date.now()): PaperStrategy {
  const futures = market === "futures";
  return {
    id: `s${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: input.name.trim(),
    color: input.color,
    note: input.note.trim(),
    investment: input.investment,
    leverage: futures ? input.leverage : 1,
    feeRate: input.feeRate,
    makerFeeRate: input.makerFeeRate,
    maintenanceMarginRate: futures ? input.maintenanceMarginRate : 0,
    createdAt: now,
    openedAt: null,
    openPrice: null,
    openDirection: 0,
    peakEquity: input.investment,
    maxDrawdown: 0,
    liquidatedAt: null,
    fundingPaid: 0,
    orders: [],
    nextOrderId: 1,
    fills: [],
    cashFlows: [],
    notice: null,
    cash: input.investment,
    position: 0,
    avgEntry: 0,
    realizedPnl: 0,
    feesPaid: 0,
    wins: 0,
    losses: 0,
    grossProfit: 0,
    grossLoss: 0,
  };
}

export const paperEquity = (l: PaperLedger, price: number) => l.cash + l.position * price;

/** 记账并返回本次成交的类型与已实现盈亏 */
function applyFill(
  l: PaperLedger,
  side: PaperSide,
  qty: number,
  price: number,
  fee: number,
): { action: PaperAction; profit: number | null } {
  const signed = side === "buy" ? qty : -qty;
  const before = l.position;
  let profit: number | null = null;
  let action: PaperAction = before === 0 ? "open" : "add";

  if (before !== 0 && Math.sign(before) !== Math.sign(signed)) {
    const closing = Math.min(qty, Math.abs(before));
    profit = closing * (price - l.avgEntry) * Math.sign(before);
    l.realizedPnl += profit;
    if (profit > 0) {
      l.wins++;
      l.grossProfit += profit;
    } else {
      l.losses++;
      l.grossLoss -= profit;
    }
    const flipped = qty > Math.abs(before) * (1 + EPS);
    action = flipped ? "reverse" : qty >= Math.abs(before) * (1 - EPS) ? "close" : "reduce";
    l.position += signed;
    if (flipped) l.avgEntry = price;
  } else {
    const size = Math.abs(before);
    l.avgEntry = (size * l.avgEntry + qty * price) / (size + qty);
    l.position += signed;
  }
  // 全部平仓后消除浮点残差
  if (Math.abs(l.position) < qty * EPS) {
    l.position = 0;
    l.avgEntry = 0;
  }
  l.cash -= signed * price + fee;
  l.feesPaid += fee;
  return { action, profit };
}

/** 现货不能卖空、不能透支；合约增加仓位时名义价值不超过 权益 × 杠杆 */
export function checkPaperOrder(
  s: PaperStrategy,
  market: MarketType,
  side: PaperSide,
  qty: number,
  price: number,
): string | null {
  if (s.liquidatedAt !== null) return "该策略已爆仓，请新建策略";
  if (!(qty > 0) || !(price > 0)) return "价格和数量必须大于 0";
  if (market === "spot") {
    if (side === "sell" && qty > s.position * (1 + EPS)) return "现货卖出数量超过持仓";
    if (side === "buy" && qty * price * (1 + s.feeRate) > s.cash * (1 + EPS)) return "可用 USDT 不足";
    return null;
  }
  const next = s.position + (side === "buy" ? qty : -qty);
  if (
    Math.abs(next) > Math.abs(s.position) &&
    Math.abs(next) * price > Math.max(paperEquity(s, price), 0) * s.leverage * (1 + EPS)
  ) {
    return "保证金不足（超过杠杆上限）";
  }
  return null;
}

/** 按指定价格计算某方向最多可下的数量 */
export function maxPaperQty(s: PaperStrategy, market: MarketType, side: PaperSide, price: number): number {
  if (s.liquidatedAt !== null || !(price > 0)) return 0;
  if (market === "spot") {
    return side === "sell" ? Math.max(s.position, 0) : Math.max(s.cash, 0) / (price * (1 + s.feeRate));
  }
  const capacity = (Math.max(paperEquity(s, price), 0) * s.leverage) / price;
  const sameDirection = s.position === 0 || (side === "buy") === s.position > 0;
  return Math.max(sameDirection ? capacity - Math.abs(s.position) : Math.abs(s.position) + capacity, 0);
}

export interface PaperResult {
  strategy: PaperStrategy;
  error: string | null;
}

/** 成交入账，并记录首次建仓的时间、价格与方向 */
function executeFill(
  s: PaperStrategy,
  side: PaperSide,
  qty: number,
  price: number,
  maker: boolean,
  time: number,
): PaperStrategy {
  const d: PaperStrategy = { ...s, fills: [...s.fills] };
  const fee = qty * price * (maker ? s.makerFeeRate : s.feeRate);
  const { action, profit } = applyFill(d, side, qty, price, fee);
  d.fills.push({ time, side, price, qty, fee, action, profit, maker });
  if (d.openedAt === null) {
    d.openedAt = time;
    d.openPrice = price;
    d.openDirection = side === "buy" ? 1 : -1;
  }
  return d;
}

/** 以当前实时价市价成交 */
export function paperTrade(
  s: PaperStrategy,
  market: MarketType,
  side: PaperSide,
  qty: number,
  price: number,
  time = Date.now(),
): PaperResult {
  const error = checkPaperOrder(s, market, side, qty, price);
  if (error) return { strategy: s, error };
  const d = executeFill(s, side, qty, price, false, time);
  return { strategy: markPaper({ ...d, notice: null }, market, price, time), error: null };
}

/** 按持仓比例减仓（1 即全部平仓） */
export function paperReduce(
  s: PaperStrategy,
  market: MarketType,
  fraction: number,
  price: number,
  time = Date.now(),
): PaperResult {
  if (s.position === 0) return { strategy: s, error: "当前没有持仓" };
  if (!(fraction > 0 && fraction <= 1)) return { strategy: s, error: "减仓比例须在 0 ~ 100% 之间" };
  const qty = Math.abs(s.position) * fraction;
  return paperTrade(s, market, s.position > 0 ? "sell" : "buy", qty, price, time);
}

export function paperClose(s: PaperStrategy, market: MarketType, price: number, time = Date.now()): PaperResult {
  return paperReduce(s, market, 1, price, time);
}

/** 挂限价单或止损单，达到触发价时按收到的实时价撮合 */
export function placePaperOrder(
  s: PaperStrategy,
  market: MarketType,
  type: PaperOrderType,
  side: PaperSide,
  price: number,
  qty: number,
  time = Date.now(),
): PaperResult {
  const error = checkPaperOrder(s, market, side, qty, price);
  if (error) return { strategy: s, error };
  return {
    strategy: {
      ...s,
      orders: [...s.orders, { id: s.nextOrderId, type, side, price, qty, createdAt: time }],
      nextOrderId: s.nextOrderId + 1,
      notice: null,
    },
    error: null,
  };
}

export function cancelPaperOrder(s: PaperStrategy, id: number): PaperStrategy {
  return { ...s, orders: s.orders.filter((o) => o.id !== id), notice: null };
}

const orderLabel = (o: PaperOrder) =>
  `${o.side === "buy" ? "买入" : "卖出"}${o.type === "limit" ? "限价" : "止损"}单 @${fmtPrice(o.price)}`;

/** 限价买 / 止损卖在价格跌到触发价时成交，限价卖 / 止损买在价格涨到触发价时成交 */
function isTriggered(o: PaperOrder, price: number) {
  const fallingTrigger = (o.type === "limit") === (o.side === "buy");
  return fallingTrigger ? price <= o.price : price >= o.price;
}

/** 按收到的实时价撮合挂单；限价单不会以优于市价的价格成交 */
function triggerOrders(s: PaperStrategy, market: MarketType, price: number, time: number): PaperStrategy {
  if (s.orders.length === 0) return s;
  const hits = s.orders.filter((o) => isTriggered(o, price));
  if (hits.length === 0) return s;
  // 触发价离现价越近越先成交
  hits.sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price));

  let d: PaperStrategy = { ...s, orders: s.orders.filter((o) => !hits.includes(o)) };
  const notices: string[] = [];
  for (const o of hits) {
    const fillPrice =
      o.type === "limit" ? (o.side === "buy" ? Math.min(o.price, price) : Math.max(o.price, price)) : price;
    const error = checkPaperOrder(d, market, o.side, o.qty, fillPrice);
    if (error) {
      notices.push(`${orderLabel(o)} 已取消：${error}`);
      continue;
    }
    d = executeFill(d, o.side, o.qty, fillPrice, o.type === "limit", time);
    notices.push(`${orderLabel(o)} 已成交 @${fmtPrice(fillPrice)}`);
  }
  d.notice = notices.join("；");
  return d;
}

/** 结算一次资金费：多头在费率为正时支付 */
export function applyFunding(s: PaperStrategy, rate: number, price: number, time: number): PaperStrategy {
  if (s.position === 0 || s.liquidatedAt !== null || !Number.isFinite(rate) || rate === 0) return s;
  const payment = s.position * price * rate;
  return {
    ...s,
    cash: s.cash - payment,
    fundingPaid: s.fundingPaid + payment,
    cashFlows: [...s.cashFlows, { time, amount: -payment, kind: "funding" }],
  };
}

/** 按最新价撮合挂单、更新权益峰值与回撤，合约权益低于维持保证金时强平 */
export function markPaper(s: PaperStrategy, market: MarketType, price: number, time = Date.now()): PaperStrategy {
  if (!(price > 0) || s.liquidatedAt !== null) return s;
  const triggered = triggerOrders(s, market, price, time);
  const equity = paperEquity(triggered, price);
  const liquidated =
    market === "futures" &&
    triggered.position !== 0 &&
    equity <= Math.abs(triggered.position) * price * triggered.maintenanceMarginRate;

  if (!liquidated) {
    const peakEquity = Math.max(triggered.peakEquity, equity);
    const maxDrawdown =
      peakEquity > 0 ? Math.max(triggered.maxDrawdown, (peakEquity - equity) / peakEquity) : triggered.maxDrawdown;
    if (triggered === s && peakEquity === s.peakEquity && maxDrawdown === s.maxDrawdown) return s;
    return { ...triggered, peakEquity, maxDrawdown };
  }

  // 强平：剩余保证金视为全部损失，挂单一并撤销
  const d: PaperStrategy = { ...triggered, fills: [...triggered.fills] };
  const qty = Math.abs(d.position);
  const side: PaperSide = d.position > 0 ? "sell" : "buy";
  const { profit } = applyFill(d, side, qty, price, 0);
  d.fills.push({ time, side, price, qty, fee: 0, action: "liquidation", profit });
  d.cash = 0;
  d.position = 0;
  d.avgEntry = 0;
  d.orders = [];
  d.liquidatedAt = time;
  d.maxDrawdown = 1;
  d.notice = `已在 ${fmtPrice(price)} 爆仓，剩余保证金全部损失`;
  return d;
}

export interface PaperStats {
  price: number;
  equity: number;
  returnPct: number;
  /** 持仓名义价值 */
  positionValue: number;
  unrealizedPnl: number;
  totalPnl: number;
  /** 可用 USDT（合约为权益减去持仓占用保证金） */
  available: number;
  /** 首次建仓至今的毫秒数 */
  holdMs: number | null;
  /** 首次建仓以来的币价涨跌 */
  priceChangeSinceOpen: number | null;
  /** 首次建仓时按同样杠杆、同样方向满仓持有至今的收益率，用于衡量策略是否跑赢一把梭 */
  holdReturn: number | null;
  closedCount: number;
  winRate: number | null;
  profitFactor: number | null;
  liquidationPrice: number | null;
}

export function paperStats(s: PaperStrategy, market: MarketType, price: number, now = Date.now()): PaperStats {
  const equity = paperEquity(s, price);
  const closed = s.wins + s.losses;
  const positionValue = s.position * price;
  const priceChangeSinceOpen = s.openPrice ? price / s.openPrice - 1 : null;
  let liquidationPrice: number | null = null;
  if (market === "futures" && s.position !== 0) {
    const qty = Math.abs(s.position);
    const mmr = s.maintenanceMarginRate;
    const p = s.position > 0 ? -s.cash / (qty * (1 - mmr)) : s.cash / (qty * (1 + mmr));
    liquidationPrice = p > 0 && Number.isFinite(p) ? p : null;
  }
  return {
    price,
    equity,
    returnPct: equity / s.investment - 1,
    positionValue,
    unrealizedPnl: s.position * (price - s.avgEntry),
    totalPnl: equity - s.investment,
    available: market === "futures" ? equity - Math.abs(positionValue) / s.leverage : s.cash,
    holdMs: s.openedAt === null ? null : now - s.openedAt,
    priceChangeSinceOpen,
    holdReturn: priceChangeSinceOpen === null ? null : priceChangeSinceOpen * s.leverage * (s.openDirection || 1),
    closedCount: closed,
    winRate: closed > 0 ? s.wins / closed : null,
    profitFactor: s.grossLoss > 0 ? s.grossProfit / s.grossLoss : null,
    liquidationPrice,
  };
}

/** 采样点超出上限时，把较早的一半隔点抽稀 */
export function compactTicks(ticks: PaperTick[]): PaperTick[] {
  if (ticks.length <= MAX_TICKS) return ticks;
  const keep = Math.floor(MAX_TICKS / 2);
  const head = ticks.slice(0, ticks.length - keep).filter((_, i) => i % 2 === 0);
  return [...head, ...ticks.slice(ticks.length - keep)];
}

/** 合并两组采样点：按秒去重，实时采样优先于回填 */
export function mergeTicks(live: PaperTick[], incoming: PaperTick[]): PaperTick[] {
  if (incoming.length === 0) return live;
  const byTime = new Map<number, PaperTick>();
  for (const t of incoming) byTime.set(Math.floor(t.time / 1000) * 1000, t);
  for (const t of live) byTime.set(t.time, t);
  return compactTicks([...byTime.values()].sort((a, b) => a.time - b.time));
}

/** 用K线收盘价补齐页面关闭期间的价格流，使收益曲线不断档 */
export function backfillBook(book: PaperBook, candles: { time: number; close: number }[]): PaperBook {
  if (candles.length === 0) return book;
  // 只补策略创建之后的部分，更早的曲线没有意义
  const from = book.strategies.reduce((min, s) => Math.min(min, s.openedAt ?? s.createdAt), Infinity);
  const incoming = candles.filter((c) => c.time >= from).map((c) => ({ time: c.time, price: c.close }));
  const ticks = mergeTicks(book.ticks, incoming);
  return ticks === book.ticks ? book : { ...book, ticks };
}

/** 记录一个实时价格采样点，结算到期的资金费，并按最新价撮合挂单、更新回撤与强平 */
export function recordTick(book: PaperBook, price: number, time = Date.now(), funding?: FundingInfo | null): PaperBook {
  if (!(price > 0)) return book;
  const last = book.ticks[book.ticks.length - 1];
  const stamp = Math.floor(time / 1000) * 1000;
  const tooSoon = last && stamp - last.time < MIN_TICK_GAP_MS;
  // 价格没变化且还在同一秒内：不产生新状态，避免无谓的重新渲染
  if (tooSoon && last.price === price) return book;
  const ticks = tooSoon
    ? // 间隔过短时只更新最后一个点的价格，保证时间戳（秒）严格递增
      [...book.ticks.slice(0, -1), { time: last.time, price }]
    : compactTicks([...book.ticks, { time: stamp, price }]);

  let strategies = book.strategies;
  let pendingFunding = book.pendingFunding;
  if (book.market === "futures") {
    const due = pendingFunding && stamp >= pendingFunding.nextTime ? pendingFunding : null;
    if (due) strategies = strategies.map((s) => applyFunding(s, due.rate, price, stamp));
    // 结算后换成下一期，接口没返回时保留上一次的费率
    if (funding && (!pendingFunding || funding.nextTime >= pendingFunding.nextTime || due)) pendingFunding = funding;
  }

  return {
    ...book,
    ticks,
    pendingFunding,
    strategies: strategies.map((s) => markPaper(s, book.market, price, stamp)),
    updatedAt: time,
  };
}

export type PaperMetric = "returnPct" | "equity" | "totalPnl" | "unrealizedPnl" | "realizedPnl" | "positionValue";

/** 在采样点上重放成交与资金费，得到该策略某项指标的历史序列；建仓之前为 null */
export function strategySeries(s: PaperStrategy, ticks: PaperTick[], metric: PaperMetric): (number | null)[] {
  const l: PaperLedger = {
    cash: s.investment,
    position: 0,
    avgEntry: 0,
    realizedPnl: 0,
    feesPaid: 0,
    wins: 0,
    losses: 0,
    grossProfit: 0,
    grossLoss: 0,
  };
  let nextFill = 0;
  let nextFlow = 0;
  return ticks.map((t) => {
    while (nextFill < s.fills.length && s.fills[nextFill].time <= t.time) {
      const f = s.fills[nextFill++];
      applyFill(l, f.side, f.qty, f.price, f.fee);
      if (f.action === "liquidation") {
        l.cash = 0;
        l.position = 0;
        l.avgEntry = 0;
      }
    }
    while (nextFlow < s.cashFlows.length && s.cashFlows[nextFlow].time <= t.time) {
      l.cash += s.cashFlows[nextFlow++].amount;
    }
    if (s.openedAt === null || t.time < s.openedAt) return null;
    const equity = paperEquity(l, t.price);
    switch (metric) {
      case "returnPct":
        return equity / s.investment - 1;
      case "equity":
        return equity;
      case "totalPnl":
        return equity - s.investment;
      case "unrealizedPnl":
        return l.position * (t.price - l.avgEntry);
      case "realizedPnl":
        return l.realizedPnl;
      case "positionValue":
        return l.position * t.price;
    }
  });
}

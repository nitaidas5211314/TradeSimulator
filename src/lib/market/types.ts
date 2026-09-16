export type MarketType = "spot" | "futures";

export const KLINE_INTERVALS = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
} as const;

export type KlineInterval = keyof typeof KLINE_INTERVALS;

export function isKlineInterval(value: string): value is KlineInterval {
  return Object.prototype.hasOwnProperty.call(KLINE_INTERVALS, value);
}

/** 单根K线，time 为开盘时间（毫秒） */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 历史资金费率，rate 为小数（0.0001 = 0.01%） */
export interface FundingRate {
  time: number;
  rate: number;
  markPrice: number | null;
  /** 尚未归档、由溢价指数估算的费率 */
  estimated?: boolean;
}

/** api = Binance REST 接口；archive = data.binance.vision 历史归档 */
export type DataSource = "api" | "archive";

export interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  /** 合约上线时间（仅合约） */
  onboardDate?: number;
}

/** API 传输用的紧凑K线格式：[time, open, high, low, close, volume] */
export type CompactCandle = [number, number, number, number, number, number];

export function toCompact(c: Candle): CompactCandle {
  return [c.time, c.open, c.high, c.low, c.close, c.volume];
}

export function fromCompact(c: CompactCandle): Candle {
  return { time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] };
}

/** 单次最多允许请求的K线数量，避免触发 Binance 限频 */
export const MAX_CANDLES = 200_000;

/** 实时行情快照（模拟盘使用） */
export interface Ticker {
  market: MarketType;
  symbol: string;
  price: number;
  /** 24 小时开盘价、最高价、最低价 */
  open: number;
  high: number;
  low: number;
  /** 24 小时涨跌幅，小数 */
  changePercent: number;
  /** 24 小时成交额（USDT） */
  quoteVolume: number;
  time: number;
  /** 合约当前资金费率与下次结算时间 */
  funding: { rate: number; nextTime: number } | null;
  /** 合约实时接口受地区限制，价格用现货近似 */
  approx: boolean;
}

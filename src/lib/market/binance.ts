import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import {
  KLINE_INTERVALS,
  MAX_CANDLES,
  type Candle,
  type FundingRate,
  type KlineInterval,
  type MarketType,
  type SymbolInfo,
} from "./types";

// 服务端 Binance 公共行情客户端（无需 API Key）

const SPOT_BASE_URLS = [
  process.env.BINANCE_SPOT_BASE_URL ?? "https://api.binance.com",
  // 公共行情镜像，主域名被地区限制（HTTP 451）时兜底
  "https://data-api.binance.vision",
];
const FUTURES_BASE_URL = process.env.BINANCE_FUTURES_BASE_URL ?? "https://fapi.binance.com";

const SPOT_KLINE_LIMIT = 1000;
const FUTURES_KLINE_LIMIT = 1500;
const FUNDING_LIMIT = 1000;
const CHUNK_CONCURRENCY = 5;
const REQUEST_TIMEOUT_MS = 20_000;

const hasProxy = Boolean(
  process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy,
);
const proxyDispatcher = hasProxy ? new EnvHttpProxyAgent() : undefined;

export class BinanceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function getJson<T>(url: string, attempt = 0): Promise<T> {
  let res: { ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> };
  try {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    res = proxyDispatcher
      ? await undiciFetch(url, { dispatcher: proxyDispatcher, signal })
      : await fetch(url, { cache: "no-store", signal });
  } catch (err) {
    if (attempt < 2) {
      await sleep(500 * (attempt + 1));
      return getJson<T>(url, attempt + 1);
    }
    throw new BinanceError(`无法连接 Binance：${(err as Error).message}`, 502);
  }

  if (res.status === 429 && attempt < 3) {
    await sleep(1500 * (attempt + 1));
    return getJson<T>(url, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new BinanceError(`Binance 返回 ${res.status}：${body.slice(0, 200)}`, res.status);
  }
  return (await res.json()) as T;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let spotBaseIndex = 0;

async function spotGet<T>(path: string): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < SPOT_BASE_URLS.length; i++) {
    const index = (spotBaseIndex + i) % SPOT_BASE_URLS.length;
    try {
      const data = await getJson<T>(SPOT_BASE_URLS[index] + path);
      spotBaseIndex = index;
      return data;
    } catch (err) {
      lastError = err;
      // 参数错误（如交易对不存在）换域名也没用
      if (err instanceof BinanceError && err.status === 400) throw err;
    }
  }
  throw lastError;
}

/** 简单的 LRU 缓存 */
class LruCache<V> {
  private map = new Map<string, V>();
  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value as string);
    }
  }
}

const klineChunkCache = new LruCache<Candle[]>(1000);
const fundingCache = new LruCache<FundingRate[]>(100);
const symbolCache = new Map<MarketType, { at: number; symbols: SymbolInfo[] }>();

type RawKline = [number, string, string, string, string, string, ...unknown[]];

async function fetchKlineChunk(
  market: MarketType,
  symbol: string,
  interval: KlineInterval,
  startTime: number,
  endTime: number,
): Promise<Candle[]> {
  const key = `${market}|${symbol}|${interval}|${startTime}|${endTime}`;
  const cached = klineChunkCache.get(key);
  if (cached) return cached;

  const limit = market === "spot" ? SPOT_KLINE_LIMIT : FUTURES_KLINE_LIMIT;
  const query = `?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`;
  const raw =
    market === "spot"
      ? await spotGet<RawKline[]>(`/api/v3/klines${query}`)
      : await getJson<RawKline[]>(`${FUTURES_BASE_URL}/fapi/v1/klines${query}`);

  const candles = raw.map((k) => ({
    time: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));

  // 只缓存已完全收盘的历史分段
  if (endTime < Date.now() - KLINE_INTERVALS[interval]) {
    klineChunkCache.set(key, candles);
  }
  return candles;
}

/** 分段并发拉取 [startTime, endTime] 区间内的全部K线 */
export async function fetchKlines(
  market: MarketType,
  symbol: string,
  interval: KlineInterval,
  startTime: number,
  endTime: number,
): Promise<Candle[]> {
  const intervalMs = KLINE_INTERVALS[interval];
  const alignedStart = Math.floor(startTime / intervalMs) * intervalMs;
  const expected = Math.ceil((endTime - alignedStart) / intervalMs);
  if (expected > MAX_CANDLES) {
    throw new BinanceError(`K线数量约 ${expected} 根，超过上限 ${MAX_CANDLES}，请缩短时间范围或增大K线周期`, 400);
  }

  const chunkSpan = (market === "spot" ? SPOT_KLINE_LIMIT : FUTURES_KLINE_LIMIT) * intervalMs;
  const chunks: [number, number][] = [];
  for (let s = alignedStart; s <= endTime; s += chunkSpan) {
    chunks.push([s, Math.min(s + chunkSpan - 1, endTime)]);
  }

  const results: Candle[][] = new Array(chunks.length);
  let next = 0;
  async function worker() {
    while (next < chunks.length) {
      const index = next++;
      const [s, e] = chunks[index];
      results[index] = await fetchKlineChunk(market, symbol, interval, s, e);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, worker));

  const seen = new Set<number>();
  return results
    .flat()
    .filter((c) => {
      if (c.time < alignedStart || c.time > endTime || seen.has(c.time)) return false;
      seen.add(c.time);
      return true;
    })
    .sort((a, b) => a.time - b.time);
}

interface RawFunding {
  fundingTime: number;
  fundingRate: string;
  markPrice: string;
}

/** 拉取 U 本位永续合约历史资金费率 */
export async function fetchFundingRates(symbol: string, startTime: number, endTime: number): Promise<FundingRate[]> {
  const key = `${symbol}|${startTime}|${endTime}`;
  const cached = fundingCache.get(key);
  if (cached) return cached;

  const rates: FundingRate[] = [];
  let cursor = startTime;
  while (cursor <= endTime) {
    const batch = await getJson<RawFunding[]>(
      `${FUTURES_BASE_URL}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${cursor}&endTime=${endTime}&limit=${FUNDING_LIMIT}`,
    );
    for (const f of batch) {
      const markPrice = Number(f.markPrice);
      rates.push({
        time: f.fundingTime,
        rate: Number(f.fundingRate),
        markPrice: f.markPrice && markPrice > 0 ? markPrice : null,
      });
    }
    if (batch.length < FUNDING_LIMIT) break;
    cursor = batch[batch.length - 1].fundingTime + 1;
  }

  if (endTime < Date.now()) fundingCache.set(key, rates);
  return rates;
}

const SYMBOL_CACHE_MS = 60 * 60 * 1000;
const POPULAR_BASES = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "TRX", "LINK", "AVAX", "SUI", "TON", "LTC", "DOT"];

/** USDT 计价、正在交易的交易对列表（合约只含永续） */
export async function fetchSymbols(market: MarketType): Promise<SymbolInfo[]> {
  const cached = symbolCache.get(market);
  if (cached && Date.now() - cached.at < SYMBOL_CACHE_MS) return cached.symbols;

  let symbols: SymbolInfo[];
  if (market === "spot") {
    const info = await spotGet<{ symbols: { symbol: string; baseAsset: string; quoteAsset: string; status: string }[] }>(
      "/api/v3/exchangeInfo?symbolStatus=TRADING&showPermissionSets=false",
    );
    symbols = info.symbols
      .filter((s) => s.quoteAsset === "USDT" && s.status === "TRADING")
      .map((s) => ({ symbol: s.symbol, baseAsset: s.baseAsset, quoteAsset: s.quoteAsset }));
  } else {
    const info = await getJson<{
      symbols: {
        symbol: string;
        baseAsset: string;
        quoteAsset: string;
        status: string;
        contractType: string;
        onboardDate: number;
      }[];
    }>(`${FUTURES_BASE_URL}/fapi/v1/exchangeInfo`);
    symbols = info.symbols
      .filter((s) => s.quoteAsset === "USDT" && s.status === "TRADING" && s.contractType === "PERPETUAL")
      .map((s) => ({ symbol: s.symbol, baseAsset: s.baseAsset, quoteAsset: s.quoteAsset, onboardDate: s.onboardDate }));
  }

  const rank = (s: SymbolInfo) => {
    const i = POPULAR_BASES.indexOf(s.baseAsset);
    return i === -1 ? POPULAR_BASES.length : i;
  };
  symbols.sort((a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol));

  symbolCache.set(market, { at: Date.now(), symbols });
  return symbols;
}

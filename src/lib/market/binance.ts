import { fetchArchiveFunding, fetchArchiveKlines, type ArchiveFunding } from "./binanceArchive";
import { BinanceError, LruCache, getJson, isRestrictedError, mapWithConcurrency } from "./http";
import {
  KLINE_INTERVALS,
  MAX_CANDLES,
  type Candle,
  type DataSource,
  type FundingRate,
  type KlineInterval,
  type MarketType,
  type SymbolInfo,
} from "./types";

// 服务端 Binance 公共行情客户端（无需 API Key）

export { BinanceError };

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

// 主域名在部分地区会直接超时：有备用数据源时快速失败，避免每次等待几十秒
const FAST_FAIL = { timeoutMs: 8_000, retries: 0 };
const FUTURES_API_REQUEST = { timeoutMs: 8_000, retries: 1 };

// 合约接口没有公共镜像：被地区限制时改用官方历史归档 data.binance.vision。
// BINANCE_FUTURES_SOURCE=archive 可强制使用归档。
const FORCE_FUTURES_ARCHIVE = process.env.BINANCE_FUTURES_SOURCE === "archive";
const FUTURES_API_RETRY_MS = 10 * 60_000;
let futuresApiBlockedUntil = 0;

async function withFuturesFallback<T>(
  api: () => Promise<T>,
  archive: () => Promise<T>,
): Promise<{ data: T; source: DataSource }> {
  if (!FORCE_FUTURES_ARCHIVE && Date.now() >= futuresApiBlockedUntil) {
    try {
      return { data: await api(), source: "api" };
    } catch (err) {
      if (!isRestrictedError(err)) throw err;
      futuresApiBlockedUntil = Date.now() + FUTURES_API_RETRY_MS;
    }
  }
  return { data: await archive(), source: "archive" };
}

let spotBaseIndex = 0;

async function spotGet<T>(path: string): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < SPOT_BASE_URLS.length; i++) {
    const index = (spotBaseIndex + i) % SPOT_BASE_URLS.length;
    const isLast = i === SPOT_BASE_URLS.length - 1;
    try {
      const data = await getJson<T>(SPOT_BASE_URLS[index] + path, isLast ? undefined : FAST_FAIL);
      spotBaseIndex = index;
      return data;
    } catch (err) {
      lastError = err;
      // 参数错误（如交易对不存在）换域名也没用
      if (err instanceof BinanceError && err.status === 400) throw err;
      // 并发中的其他请求直接从下一个域名开始
      if (spotBaseIndex === index) spotBaseIndex = (index + 1) % SPOT_BASE_URLS.length;
    }
  }
  throw lastError;
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
      : await getJson<RawKline[]>(`${FUTURES_BASE_URL}/fapi/v1/klines${query}`, FUTURES_API_REQUEST);

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

/** 通过 REST 接口分段并发拉取 */
async function fetchApiKlines(
  market: MarketType,
  symbol: string,
  interval: KlineInterval,
  startTime: number,
  endTime: number,
): Promise<Candle[]> {
  const chunkSpan = (market === "spot" ? SPOT_KLINE_LIMIT : FUTURES_KLINE_LIMIT) * KLINE_INTERVALS[interval];
  const chunks: [number, number][] = [];
  for (let s = startTime; s <= endTime; s += chunkSpan) {
    chunks.push([s, Math.min(s + chunkSpan - 1, endTime)]);
  }
  const results = await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, ([s, e]) =>
    fetchKlineChunk(market, symbol, interval, s, e),
  );

  const seen = new Set<number>();
  return results
    .flat()
    .filter((c) => {
      if (c.time < startTime || c.time > endTime || seen.has(c.time)) return false;
      seen.add(c.time);
      return true;
    })
    .sort((a, b) => a.time - b.time);
}

/** 拉取 [startTime, endTime] 区间内的全部K线 */
export async function fetchKlines(
  market: MarketType,
  symbol: string,
  interval: KlineInterval,
  startTime: number,
  endTime: number,
): Promise<{ candles: Candle[]; source: DataSource }> {
  const intervalMs = KLINE_INTERVALS[interval];
  const alignedStart = Math.floor(startTime / intervalMs) * intervalMs;
  const expected = Math.ceil((endTime - alignedStart) / intervalMs);
  if (expected > MAX_CANDLES) {
    throw new BinanceError(`K线数量约 ${expected} 根，超过上限 ${MAX_CANDLES}，请缩短时间范围或增大K线周期`, 400);
  }

  if (market === "spot") {
    return { candles: await fetchApiKlines(market, symbol, interval, alignedStart, endTime), source: "api" };
  }
  const { data, source } = await withFuturesFallback(
    () => fetchApiKlines(market, symbol, interval, alignedStart, endTime),
    () => fetchArchiveKlines(symbol, interval, alignedStart, endTime),
  );
  return { candles: data, source };
}

interface RawFunding {
  fundingTime: number;
  fundingRate: string;
  markPrice: string;
}

async function fetchApiFunding(symbol: string, startTime: number, endTime: number): Promise<FundingRate[]> {
  const key = `${symbol}|${startTime}|${endTime}`;
  const cached = fundingCache.get(key);
  if (cached) return cached;

  const rates: FundingRate[] = [];
  let cursor = startTime;
  while (cursor <= endTime) {
    const batch = await getJson<RawFunding[]>(
      `${FUTURES_BASE_URL}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${cursor}&endTime=${endTime}&limit=${FUNDING_LIMIT}`,
      FUTURES_API_REQUEST,
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

/** 拉取 U 本位永续合约历史资金费率 */
export async function fetchFundingRates(
  symbol: string,
  startTime: number,
  endTime: number,
): Promise<ArchiveFunding & { source: DataSource }> {
  const { data, source } = await withFuturesFallback<ArchiveFunding>(
    async () => ({ rates: await fetchApiFunding(symbol, startTime, endTime), estimatedFrom: null }),
    () => fetchArchiveFunding(symbol, startTime, endTime),
  );
  return { ...data, source };
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
    try {
      const info = await getJson<{
        symbols: {
          symbol: string;
          baseAsset: string;
          quoteAsset: string;
          status: string;
          contractType: string;
          onboardDate: number;
        }[];
      }>(`${FUTURES_BASE_URL}/fapi/v1/exchangeInfo`, FUTURES_API_REQUEST);
      symbols = info.symbols
        .filter((s) => s.quoteAsset === "USDT" && s.status === "TRADING" && s.contractType === "PERPETUAL")
        .map((s) => ({ symbol: s.symbol, baseAsset: s.baseAsset, quoteAsset: s.quoteAsset, onboardDate: s.onboardDate }));
    } catch (err) {
      if (!isRestrictedError(err)) throw err;
      // 合约接口受限时用现货列表近似，绝大多数永续合约都有同名现货
      symbols = await fetchSymbols("spot");
    }
  }

  const rank = (s: SymbolInfo) => {
    const i = POPULAR_BASES.indexOf(s.baseAsset);
    return i === -1 ? POPULAR_BASES.length : i;
  };
  symbols = [...symbols].sort((a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol));

  symbolCache.set(market, { at: Date.now(), symbols });
  return symbols;
}

import {
  KLINE_INTERVALS,
  fromCompact,
  type Candle,
  type CompactCandle,
  type FundingRate,
  type KlineInterval,
  type MarketType,
  type SymbolInfo,
} from "./types";

// 浏览器端调用本站 API 路由

export interface DatasetRequest {
  market: MarketType;
  symbol: string;
  interval: KlineInterval;
  start: number;
  end: number;
}

export interface MarketDataset extends DatasetRequest {
  key: string;
  candles: Candle[];
  funding: FundingRate[];
}

export function datasetKey(r: DatasetRequest) {
  return `${r.market}|${r.symbol}|${r.interval}|${r.start}|${r.end}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({ error: `请求失败（${res.status}）` }));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `请求失败（${res.status}）`);
  return body as T;
}

export async function loadDataset(r: DatasetRequest): Promise<MarketDataset> {
  const range = `symbol=${r.symbol}&start=${r.start}&end=${r.end}`;
  const [klines, funding] = await Promise.all([
    getJson<{ candles: CompactCandle[] }>(`/api/klines?market=${r.market}&interval=${r.interval}&${range}`),
    r.market === "futures"
      ? getJson<{ rates: FundingRate[] }>(`/api/funding?${range}`)
      : Promise.resolve({ rates: [] as FundingRate[] }),
  ]);
  if (klines.candles.length === 0) {
    throw new Error("该时间段没有K线数据，可能交易对尚未上线");
  }
  return { ...r, key: datasetKey(r), candles: klines.candles.map(fromCompact), funding: funding.rates };
}

export async function loadSymbols(market: MarketType): Promise<SymbolInfo[]> {
  const data = await getJson<{ symbols: SymbolInfo[] }>(`/api/symbols?market=${market}`);
  return data.symbols;
}

export function estimateCandles(start: number, end: number, interval: KlineInterval) {
  return Math.max(0, Math.ceil((end - start) / KLINE_INTERVALS[interval]));
}

const AUTO_TARGET_CANDLES = 20_000;

/** 在不超过目标数量的前提下选择最细的K线周期，越细回测越精确 */
export function autoInterval(start: number, end: number): KlineInterval {
  const candidates: KlineInterval[] = ["5m", "15m", "1h", "4h", "1d"];
  return candidates.find((i) => estimateCandles(start, end, i) <= AUTO_TARGET_CANDLES) ?? "1d";
}

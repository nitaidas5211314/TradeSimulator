import { strFromU8, unzipSync } from "fflate";
import {
  DAY_MS,
  archiveUnits,
  dayUnits,
  estimateFundingRates,
  fmtMonth,
  monthStartUtc,
  nextMonthUtc,
  parseCsvRows,
  rowsToCandles,
  rowsToFunding,
  type ArchiveUnit,
} from "./archiveUtils";
import { BinanceError, LruCache, httpGet, mapWithConcurrency } from "./http";
import type { Candle, FundingRate, KlineInterval } from "./types";

// Binance 官方历史数据归档（U 本位合约）。合约 API 被地区限制时的数据源。
// 文件按月/按日打包为 zip，均为不可变文件，可放心缓存。

const ARCHIVE_BASE = `${process.env.BINANCE_ARCHIVE_BASE_URL ?? "https://data.binance.vision"}/data/futures/um`;
const CONCURRENCY = 6;

const candleCache = new LruCache<Candle[]>(60);
const fundingCache = new LruCache<ReturnType<typeof rowsToFunding>>(200);
const premiumCache = new LruCache<[number, number][]>(120);

/** 下载并解压归档文件，文件不存在时返回 null */
async function fetchArchiveCsv(path: string): Promise<string[][] | null> {
  const res = await httpGet(`${ARCHIVE_BASE}/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new BinanceError(`Binance 历史归档返回 ${res.status}（${path}）`, 502);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const csv = Object.values(files)[0];
  return csv ? parseCsvRows(strFromU8(csv)) : [];
}

async function cachedArchive<V>(cache: LruCache<V>, path: string, parse: (rows: string[][]) => V): Promise<V | null> {
  const hit = cache.get(path);
  if (hit) return hit;
  const rows = await fetchArchiveCsv(path);
  if (!rows) return null;
  const value = parse(rows);
  cache.set(path, value);
  return value;
}

function klinePath(symbol: string, interval: KlineInterval, unit: ArchiveUnit) {
  const folder = unit.kind === "month" ? "monthly" : "daily";
  return `${folder}/klines/${symbol}/${interval}/${symbol}-${interval}-${unit.label}.zip`;
}

export async function fetchArchiveKlines(
  symbol: string,
  interval: KlineInterval,
  startTime: number,
  endTime: number,
): Promise<Candle[]> {
  const now = Date.now();
  const units = archiveUnits(startTime, endTime, now);
  if (units.length === 0) {
    throw new BinanceError("合约接口受限，历史归档数据最新只到昨天（UTC），请把开始日期提前", 400);
  }
  const previousMonth = monthStartUtc(monthStartUtc(now) - 1);
  const load = (unit: ArchiveUnit) => cachedArchive(candleCache, klinePath(symbol, interval, unit), rowsToCandles);

  const parts = await mapWithConcurrency(units, CONCURRENCY, async (unit) => {
    const candles = await load(unit);
    if (candles || unit.kind !== "month" || unit.start < previousMonth) return candles ?? [];
    // 月初上个月的月文件可能还没发布，退回日文件
    const days = dayUnits(Math.max(unit.start, startTime), Math.min(nextMonthUtc(unit.start) - 1, endTime));
    const dayParts = await mapWithConcurrency(days, 2, load);
    return dayParts.flatMap((p) => p ?? []);
  });

  const seen = new Set<number>();
  const candles = parts
    .flat()
    .filter((c) => {
      if (c.time < startTime || c.time > endTime || seen.has(c.time)) return false;
      seen.add(c.time);
      return true;
    })
    .sort((a, b) => a.time - b.time);

  if (candles.length === 0) {
    throw new BinanceError(`合约接口受限，且 Binance 历史归档中没有 ${symbol} 在该时间段的合约K线`, 400);
  }
  return candles;
}

export interface ArchiveFunding {
  rates: FundingRate[];
  /** 从该时间起的资金费率为估算值 */
  estimatedFrom: number | null;
}

export async function fetchArchiveFunding(symbol: string, startTime: number, endTime: number): Promise<ArchiveFunding> {
  const now = Date.now();
  const months: number[] = [];
  for (let m = monthStartUtc(startTime); m <= endTime; m = nextMonthUtc(m)) months.push(m);

  const monthly = await mapWithConcurrency(months, CONCURRENCY, (m) =>
    cachedArchive(fundingCache, `monthly/fundingRate/${symbol}/${symbol}-fundingRate-${fmtMonth(m)}.zip`, rowsToFunding),
  );
  const archived = monthly.flatMap((p) => p?.rates ?? []);
  const rates = archived.filter((r) => r.time >= startTime && r.time <= endTime);

  // 最近一两个月的资金费率还没有归档，按溢价指数估算
  const previousMonth = monthStartUtc(monthStartUtc(now) - 1);
  const firstMissing = months.find((m, i) => !monthly[i] && m >= previousMonth);
  if (firstMissing === undefined) return { rates, estimatedFrom: null };

  const intervalHours = monthly.findLast((p) => p?.intervalHours)?.intervalHours ?? 8;
  const lastArchived = archived.at(-1)?.time ?? -Infinity;
  // 估算 (from, to] 内的结算；溢价指数日文件最新到昨天
  const from = Math.max(startTime - 1, firstMissing - 1, lastArchived);
  const to = Math.min(endTime, Math.floor(now / DAY_MS) * DAY_MS);
  if (from >= to) return { rates, estimatedFrom: null };

  const days = dayUnits(from - intervalHours * 3_600_000, to - 1);
  const premiumParts = await mapWithConcurrency(days, CONCURRENCY, (d) =>
    cachedArchive(premiumCache, `daily/premiumIndexKlines/${symbol}/1m/${symbol}-1m-${d.label}.zip`, (rows) =>
      rows.map((c) => [Number(c[0]), Number(c[4])] as [number, number]),
    ),
  );
  const premium = new Map<number, number>();
  for (const part of premiumParts) for (const [time, value] of part ?? []) premium.set(time, value);

  const estimated = estimateFundingRates(premium, from, to, intervalHours);
  return { rates: [...rates, ...estimated], estimatedFrom: estimated[0]?.time ?? null };
}

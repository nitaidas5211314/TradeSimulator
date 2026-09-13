import type { Candle, FundingRate } from "./types";

// Binance 历史归档（data.binance.vision）相关的纯函数

export const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

export function monthStartUtc(ms: number) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function nextMonthUtc(ms: number) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export function fmtMonth(ms: number) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function fmtDay(ms: number) {
  const d = new Date(ms);
  return `${fmtMonth(ms)}-${pad(d.getUTCDate())}`;
}

/** 解析归档 CSV，跳过表头（新文件有表头，老文件没有） */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cells = trimmed.split(",");
    if (!/^\d+$/.test(cells[0])) continue;
    rows.push(cells);
  }
  return rows;
}

/** open_time,open,high,low,close,volume,... */
export function rowsToCandles(rows: string[][]): Candle[] {
  return rows.map((c) => ({
    time: Number(c[0]),
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[5]),
  }));
}

/** calc_time,funding_interval_hours,last_funding_rate */
export function rowsToFunding(rows: string[][]): { rates: FundingRate[]; intervalHours: number | null } {
  const rates = rows.map((c) => ({ time: Number(c[0]), rate: Number(c[2]), markPrice: null }));
  const last = rows.at(-1);
  return { rates, intervalHours: last ? Number(last[1]) || null : null };
}

export interface ArchiveUnit {
  kind: "month" | "day";
  start: number;
  label: string;
}

export function dayUnits(from: number, to: number): ArchiveUnit[] {
  const units: ArchiveUnit[] = [];
  for (let d = Math.floor(from / DAY_MS) * DAY_MS; d <= to; d += DAY_MS) {
    units.push({ kind: "day", start: d, label: fmtDay(d) });
  }
  return units;
}

/**
 * 把时间段拆成归档文件：当月之前用月文件，当月用日文件。
 * 日文件次日才发布，所以最多到昨天。
 */
export function archiveUnits(start: number, end: number, now: number): ArchiveUnit[] {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const last = Math.min(end, today - 1);
  const currentMonth = monthStartUtc(now);
  const units: ArchiveUnit[] = [];
  for (let m = monthStartUtc(start); m <= last; m = nextMonthUtc(m)) {
    if (m < currentMonth) units.push({ kind: "month", start: m, label: fmtMonth(m) });
    else units.push(...dayUnits(Math.max(m, start), last));
  }
  return units;
}

/**
 * 按 Binance 资金费率公式由 1 分钟溢价指数估算资金费率：
 *   P = 结算周期内溢价指数的加权平均（越靠近结算权重越大）
 *   F = P + clamp(I − P, −0.05%, +0.05%)，I 为利率（每 8 小时 0.01%）
 * 只输出 (from, to] 内且溢价数据覆盖率 ≥ 80% 的结算时刻。
 */
export function estimateFundingRates(
  premium: Map<number, number>,
  from: number,
  to: number,
  intervalHours: number,
): FundingRate[] {
  const intervalMs = intervalHours * 3_600_000;
  const minutes = intervalHours * 60;
  const interest = 0.0001 * (intervalHours / 8);
  const rates: FundingRate[] = [];

  for (let t = (Math.floor(from / intervalMs) + 1) * intervalMs; t <= to; t += intervalMs) {
    let weighted = 0;
    let weights = 0;
    let samples = 0;
    for (let i = 1; i <= minutes; i++) {
      const value = premium.get(t - (minutes - i + 1) * 60_000);
      if (value === undefined) continue;
      weighted += i * value;
      weights += i;
      samples++;
    }
    if (samples < minutes * 0.8) continue;
    const p = weighted / weights;
    rates.push({ time: t, rate: p + Math.min(Math.max(interest - p, -0.0005), 0.0005), markPrice: null, estimated: true });
  }
  return rates;
}

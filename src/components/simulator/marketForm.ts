import { fmtDate, parseDateUtc } from "@/lib/format";
import { autoInterval, estimateCandles, type DatasetRequest } from "@/lib/market/client";
import { MAX_CANDLES, type KlineInterval, type MarketType } from "@/lib/market/types";

const DAY = 86_400_000;

export type IntervalChoice = "auto" | KlineInterval;

export interface MarketForm {
  market: MarketType;
  symbol: string;
  startDate: string;
  endDate: string;
  interval: IntervalChoice;
}

export function datePreset(days: number, now = Date.now()) {
  return { startDate: fmtDate(now - days * DAY), endDate: fmtDate(now) };
}

export function createMarketForm(
  options: { market?: MarketType; days?: number; interval?: IntervalChoice } = {},
  now = Date.now(),
): MarketForm {
  return {
    market: options.market ?? "spot",
    symbol: "BTCUSDT",
    ...datePreset(options.days ?? 90, now),
    interval: options.interval ?? "auto",
  };
}

export interface RequestInfo {
  request: DatasetRequest | null;
  interval: KlineInterval | null;
  estimate: number;
  error: string | null;
}

export function buildRequest(form: MarketForm, now = Date.now()): RequestInfo {
  const symbol = form.symbol.trim().toUpperCase();
  const fail = (error: string): RequestInfo => ({ request: null, interval: null, estimate: 0, error });
  if (!/^[A-Z0-9]{2,30}$/.test(symbol)) return fail("请输入正确的交易对，如 BTCUSDT");
  if (!form.startDate || !form.endDate) return fail("请选择开始和结束日期");

  const start = parseDateUtc(form.startDate);
  const end = Math.min(parseDateUtc(form.endDate) + DAY - 1, now);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return fail("日期格式不正确");
  if (start >= end) return fail("开始日期必须早于结束日期");

  const interval = form.interval === "auto" ? autoInterval(start, end) : form.interval;
  const estimate = estimateCandles(start, end, interval);
  if (estimate > MAX_CANDLES) {
    return { request: null, interval, estimate, error: `预计 ${estimate.toLocaleString()} 根K线，超过上限，请增大周期` };
  }
  return { request: { market: form.market, symbol, interval, start, end }, interval, estimate, error: null };
}

export const formKeyOf = (f: MarketForm) => [f.market, f.symbol, f.startDate, f.endDate, f.interval].join("|");

import { isKlineInterval, type KlineInterval, type MarketType } from "./types";

// API 路由共用的查询参数校验

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const SYMBOL_RE = /^[A-Z0-9]{2,30}$/;

export function parseMarket(value: string | null): ParseResult<MarketType> {
  return value === "spot" || value === "futures" ? { ok: true, value } : { ok: false, error: "market 须为 spot 或 futures" };
}

export function parseSymbol(value: string | null): ParseResult<string> {
  const symbol = (value ?? "").toUpperCase();
  return SYMBOL_RE.test(symbol) ? { ok: true, value: symbol } : { ok: false, error: "交易对格式不正确" };
}

export function parseInterval(value: string | null): ParseResult<KlineInterval> {
  return value && isKlineInterval(value) ? { ok: true, value } : { ok: false, error: "K线周期不支持" };
}

export function parseTimeRange(start: string | null, end: string | null): ParseResult<{ start: number; end: number }> {
  const s = Number(start);
  const e = Math.min(Number(end), Date.now());
  if (!Number.isFinite(s) || !Number.isFinite(e) || s <= 0) return { ok: false, error: "时间参数不正确" };
  if (s >= e) return { ok: false, error: "开始时间必须早于结束时间" };
  return { ok: true, value: { start: s, end: e } };
}

export function badRequest(error: string, status = 400) {
  return Response.json({ error }, { status });
}

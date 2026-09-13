import type { GridMode, SimulationParams } from "@/lib/backtest/grid";
import { fmtDate, parseDateUtc } from "@/lib/format";
import { autoInterval, estimateCandles, type DatasetRequest } from "@/lib/market/client";
import { MAX_CANDLES, type KlineInterval, type MarketType } from "@/lib/market/types";

const DAY = 86_400_000;

export type IntervalChoice = "auto" | KlineInterval;

export interface FeeInputs {
  /** 百分比字符串，如 "0.1" 表示 0.1% */
  maker: string;
  taker: string;
}

/** 表单状态：数值字段保存为字符串，便于输入中间态 */
export interface FormState {
  market: MarketType;
  symbol: string;
  startDate: string;
  endDate: string;
  interval: IntervalChoice;
  lower: string;
  upper: string;
  gridCount: string;
  gridMode: GridMode;
  investment: string;
  leverage: string;
  /** 百分比 */
  maintenanceMarginRate: string;
  includeFunding: boolean;
  fees: Record<MarketType, FeeInputs>;
}

export const DEFAULT_FEES: Record<MarketType, FeeInputs> = {
  spot: { maker: "0.1", taker: "0.1" },
  futures: { maker: "0.02", taker: "0.05" },
};

export function datePreset(days: number, now = Date.now()) {
  return { startDate: fmtDate(now - days * DAY), endDate: fmtDate(now) };
}

export function createDefaultForm(now = Date.now()): FormState {
  return {
    market: "spot",
    symbol: "BTCUSDT",
    ...datePreset(90, now),
    interval: "auto",
    lower: "",
    upper: "",
    gridCount: "20",
    gridMode: "arithmetic",
    investment: "10000",
    leverage: "3",
    maintenanceMarginRate: "0.5",
    includeFunding: true,
    fees: DEFAULT_FEES,
  };
}

export interface RequestInfo {
  request: DatasetRequest | null;
  interval: KlineInterval | null;
  estimate: number;
  error: string | null;
}

export function buildRequest(form: FormState, now = Date.now()): RequestInfo {
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

const num = (value: string) => (value.trim() === "" ? NaN : Number(value));

/** 表单 → 回测参数；market 取已加载数据的市场，保证费率与数据一致 */
export function toSimParams(form: FormState, market: MarketType): SimulationParams {
  const fees = form.fees[market];
  return {
    market,
    investment: num(form.investment),
    lower: num(form.lower),
    upper: num(form.upper),
    gridCount: num(form.gridCount),
    gridMode: form.gridMode,
    leverage: num(form.leverage),
    makerFee: num(fees.maker) / 100,
    takerFee: num(fees.taker) / 100,
    maintenanceMarginRate: num(form.maintenanceMarginRate) / 100,
    includeFunding: form.includeFunding,
  };
}

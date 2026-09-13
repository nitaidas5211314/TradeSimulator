import type { Candle } from "@/lib/market/types";
import { HOLD_META, holdStrategy, runStrategies, validateCosts, type StrategyMeta, type StrategyResult } from "./common";
import type { Strategy } from "./engine";

export type DcaPeriod = "day" | "week" | "biweek" | "month";
export type DcaMode = "fixed" | "value";

export const DCA_PERIOD_LABEL: Record<DcaPeriod, string> = {
  day: "每天",
  week: "每周",
  biweek: "每两周",
  month: "每月",
};

export const DCA_META = {
  "lump-sum": { ...HOLD_META.spot, name: "一次性买入", description: "把全部计划资金在开始时一次性买入并持有" },
  "dca-fixed": { name: "定期定额", color: "#3b82f6", description: "每期固定金额市价买入" },
  "dca-value": {
    name: "价值平均",
    color: "#22c55e",
    description: "每期让持仓市值增加固定金额：下跌时多买、上涨时少买甚至不买，单期金额有上限",
  },
} satisfies Record<string, StrategyMeta>;

export interface DcaParams {
  /** 每期金额（USDT） */
  amount: number;
  period: DcaPeriod;
  /** 价值平均单期最多买入每期金额的倍数 */
  maxMultiple: number;
  makerFee: number;
  takerFee: number;
}

export const MAX_DCA_MULTIPLE = 20;

const DAY_MS = 86_400_000;

function addMonthsUtc(ms: number, months: number) {
  const d = new Date(ms);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes()));
  const daysInMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), daysInMonth));
  return target.getTime();
}

/** 定投时间表：从 start 开始每期一次，不晚于 end；按月时月末日期自动取当月最后一天 */
export function dcaSchedule(start: number, end: number, period: DcaPeriod): number[] {
  const step = period === "day" ? DAY_MS : period === "week" ? 7 * DAY_MS : 14 * DAY_MS;
  const times: number[] = [];
  for (let i = 0; ; i++) {
    const t = period === "month" ? addMonthsUtc(start, i) : start + i * step;
    if (t > end) break;
    times.push(t);
  }
  return times;
}

export function validateDcaParams(p: DcaParams): string | null {
  if (!(p.amount > 0)) return "每期金额必须大于 0";
  if (!(p.maxMultiple >= 1 && p.maxMultiple <= MAX_DCA_MULTIPLE)) return `单期上限倍数须在 1 ~ ${MAX_DCA_MULTIPLE} 之间`;
  return validateCosts("spot", {
    makerFee: p.makerFee,
    takerFee: p.takerFee,
    leverage: 1,
    maintenanceMarginRate: 0,
    includeFunding: false,
  });
}

/**
 * 定投策略，在到期后的第一根K线开盘价市价买入。
 * - fixed：每期买入固定金额
 * - value：价值平均，使持仓市值达到「已过期数 × 每期金额」，不卖出，单期不超过上限倍数
 */
export function dcaStrategy(times: number[], amount: number, mode: DcaMode, maxMultiple: number): Strategy {
  let next = 0;
  let spent = 0;
  let cost = 0;
  let qty = 0;
  let buys = 0;

  return {
    start() {},

    onBar(ctx, candle) {
      let due = 0;
      while (next < times.length && times[next] <= candle.time) {
        next++;
        due++;
      }
      if (due === 0) return;

      const price = candle.open;
      const want =
        mode === "fixed"
          ? amount * due
          : Math.min(Math.max(next * amount - ctx.position * price, 0), amount * maxMultiple);
      const quote = Math.min(want, ctx.cash / (1 + ctx.takerFee));
      if (quote <= amount * 1e-9) return;

      const q = quote / price;
      ctx.trade(q, price, { maker: false, action: "dca" });
      spent += quote * (1 + ctx.takerFee);
      cost += quote;
      qty += q;
      buys++;
    },

    metrics(ctx, lastPrice) {
      return {
        invested: spent,
        buyCount: buys,
        avgCost: qty > 0 ? cost / qty : null,
        holdingReturn: spent > 0 ? (qty * lastPrice - spent) / spent : null,
        cash: ctx.cash,
      };
    },
  };
}

/** 一次性买入 vs 定期定额 vs 价值平均，三者使用相同的计划总资金 */
export function runDcaSimulation(candles: Candle[], intervalMs: number, p: DcaParams): StrategyResult[] {
  const times = dcaSchedule(candles[0].time, candles[candles.length - 1].time, p.period);
  const capital = times.length * p.amount * (1 + p.takerFee);
  const startPrice = candles[0].open;

  return runStrategies(
    {
      candles,
      funding: [],
      intervalMs,
      market: "spot",
      investment: capital,
      costs: { makerFee: p.makerFee, takerFee: p.takerFee, leverage: 1, maintenanceMarginRate: 0, includeFunding: false },
    },
    [
      {
        id: "lump-sum",
        meta: DCA_META["lump-sum"],
        strategy: holdStrategy(capital / (startPrice * (1 + p.takerFee))),
      },
      { id: "dca-fixed", meta: DCA_META["dca-fixed"], strategy: dcaStrategy(times, p.amount, "fixed", p.maxMultiple) },
      { id: "dca-value", meta: DCA_META["dca-value"], strategy: dcaStrategy(times, p.amount, "value", p.maxMultiple) },
    ],
  );
}

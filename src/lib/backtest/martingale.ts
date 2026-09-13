import type { Candle, FundingRate, MarketType } from "@/lib/market/types";
import {
  HOLD_META,
  holdStrategy,
  runStrategies,
  validateCosts,
  type CostParams,
  type StrategyMeta,
  type StrategyResult,
  type StrategyRun,
} from "./common";
import type { Strategy, StrategyContext } from "./engine";

export const MARTINGALE_META = {
  "martingale-spot": {
    name: "马丁格尔（现货）",
    color: "#3b82f6",
    description: "市价买入首单，每跌一定幅度按倍数挂单加仓，均价上涨达到止盈比例后全部卖出并开始下一轮",
  },
  "martingale-long": {
    name: "马丁格尔做多",
    color: "#22c55e",
    description: "市价开多首单，每跌一定幅度按倍数加多，均价上涨达到止盈比例后全部平仓并开始下一轮",
  },
  "martingale-short": {
    name: "马丁格尔做空",
    color: "#ef4444",
    description: "市价开空首单，每涨一定幅度按倍数加空，均价下跌达到止盈比例后全部平仓并开始下一轮",
  },
} satisfies Record<string, StrategyMeta>;

export interface MartingaleLadderConfig {
  /** 首次加仓相对首单价格的偏离（小数） */
  priceStep: number;
  /** 后续每次加仓间隔相对上一次的倍数 */
  stepScale: number;
  /** 每次加仓金额相对上一次的倍数 */
  volumeScale: number;
  maxSafetyOrders: number;
  /** 相对持仓均价的止盈比例（小数） */
  takeProfit: number;
}

export interface MartingaleParams extends CostParams, MartingaleLadderConfig {
  market: MarketType;
  investment: number;
  /** 相对持仓均价的止损比例（小数），0 表示不止损 */
  stopLoss: number;
}

export const MAX_SAFETY_ORDERS = 30;

/** 第 k 次加仓（k ≥ 1）相对首单价格的累计偏离 */
export function safetyDeviation(k: number, priceStep: number, stepScale: number) {
  let deviation = 0;
  let step = priceStep;
  for (let i = 0; i < k; i++) {
    deviation += step;
    step *= stepScale;
  }
  return deviation;
}

export interface LadderRow {
  deviation: number;
  quote: number;
}

/** 加仓阶梯：各层偏离与金额；以及做多全部加仓后的均价偏离、需要反弹多少才能止盈 */
export function martingaleLadder(capital: number, c: MartingaleLadderConfig) {
  const weights = Array.from({ length: c.maxSafetyOrders + 1 }, (_, k) => Math.pow(c.volumeScale, k));
  const baseQuote = capital / weights.reduce((sum, w) => sum + w, 0);
  const rows: LadderRow[] = weights.map((w, k) => ({
    deviation: safetyDeviation(k, c.priceStep, c.stepScale),
    quote: baseQuote * w,
  }));

  // 以首单价格为 1 计算满仓均价
  let quoteSum = 0;
  let qtySum = 0;
  for (const row of rows) {
    quoteSum += row.quote;
    qtySum += row.quote / (1 - row.deviation);
  }
  const fullAvg = quoteSum / qtySum;
  const lastPrice = 1 - rows[rows.length - 1].deviation;
  return {
    baseQuote,
    rows,
    fullAvgDeviation: 1 - fullAvg,
    reboundToTakeProfit: (fullAvg * (1 + c.takeProfit)) / lastPrice - 1,
  };
}

export function validateMartingaleParams(p: MartingaleParams): string | null {
  if (!(p.investment > 0)) return "投入资金必须大于 0";
  if (!(p.priceStep > 0 && p.priceStep < 1)) return "加仓间隔须在 0% ~ 100% 之间";
  if (!(p.stepScale >= 0.5 && p.stepScale <= 5)) return "间隔倍数须在 0.5 ~ 5 之间";
  if (!(p.volumeScale >= 0.5 && p.volumeScale <= 10)) return "加仓倍数须在 0.5 ~ 10 之间";
  if (!Number.isInteger(p.maxSafetyOrders) || p.maxSafetyOrders < 0 || p.maxSafetyOrders > MAX_SAFETY_ORDERS) {
    return `最大加仓次数须为 0 ~ ${MAX_SAFETY_ORDERS} 的整数`;
  }
  if (!(p.takeProfit > 0 && p.takeProfit < 1)) return "止盈比例须在 0% ~ 100% 之间";
  if (!(p.stopLoss >= 0 && p.stopLoss < 1)) return "止损比例须在 0% ~ 100% 之间（0 表示不止损）";
  if (safetyDeviation(p.maxSafetyOrders, p.priceStep, p.stepScale) >= 0.95) {
    return "最后一次加仓的累计跌幅须小于 95%，请减少加仓次数或间隔";
  }
  return validateCosts(p.market, p);
}

export interface MartingaleConfig extends MartingaleLadderConfig {
  direction: 1 | -1;
  /** 首单金额（USDT 名义价值） */
  baseQuote: number;
  stopLoss: number | null;
}

interface MartingaleEvent {
  price: number;
  type: "safety" | "takeProfit" | "stopLoss";
}

/**
 * 马丁格尔：市价开首单，按阶梯挂加仓单；均价达到止盈比例时挂单全部平仓，
 * 随即以当前价开始下一轮。触发止损后市价平仓并停止。
 */
export function martingaleStrategy(c: MartingaleConfig): Strategy {
  const dir = c.direction;
  const deviations = Array.from({ length: c.maxSafetyOrders }, (_, i) => safetyDeviation(i + 1, c.priceStep, c.stepScale));

  let active = false;
  let basePrice = 0;
  let qty = 0;
  let cost = 0;
  let filled = 0;
  let cycles = 0;
  let stops = 0;
  let maxFilled = 0;

  const openCycle = (ctx: StrategyContext, price: number) => {
    active = true;
    basePrice = price;
    qty = c.baseQuote / price;
    cost = c.baseQuote;
    filled = 0;
    ctx.trade(dir * qty, price, { maker: false, action: "base" });
  };

  const closeCycle = (ctx: StrategyContext, price: number, action: "takeProfit" | "stopLoss") => {
    active = false;
    ctx.trade(-dir * qty, price, { maker: action === "takeProfit", action, profit: dir * (qty * price - cost) });
  };

  return {
    start: openCycle,

    onMove(ctx, from, to) {
      const down = to < from;
      // 逆势（做多下跌 / 做空上涨）触发加仓和止损，顺势触发止盈
      const adverse = down === (dir === 1);
      let cursor = from;
      const reached = (price: number) => (down ? price <= cursor && price >= to : price >= cursor && price <= to);

      while (active) {
        const avg = cost / qty;
        const candidates: MartingaleEvent[] = [];
        if (adverse) {
          if (filled < deviations.length) {
            candidates.push({ price: basePrice * (1 - dir * deviations[filled]), type: "safety" });
          }
          if (c.stopLoss !== null) candidates.push({ price: avg * (1 - dir * c.stopLoss), type: "stopLoss" });
        } else {
          candidates.push({ price: avg * (1 + dir * c.takeProfit), type: "takeProfit" });
        }

        const hits = candidates.filter((e) => reached(e.price));
        if (hits.length === 0) break;
        // 沿路径先到达的价格先成交
        const event = hits.reduce((a, b) => ((down ? b.price > a.price : b.price < a.price) ? b : a));
        cursor = event.price;

        if (event.type === "safety") {
          const quote = c.baseQuote * Math.pow(c.volumeScale, filled + 1);
          const q = quote / event.price;
          qty += q;
          cost += quote;
          filled++;
          maxFilled = Math.max(maxFilled, filled);
          ctx.trade(dir * q, event.price, { maker: true, action: "safety" });
        } else if (event.type === "takeProfit") {
          closeCycle(ctx, event.price, "takeProfit");
          cycles++;
          openCycle(ctx, event.price);
        } else {
          closeCycle(ctx, event.price, "stopLoss");
          stops++;
        }
      }
    },

    metrics() {
      return {
        cycles,
        stops,
        maxSafetyUsed: maxFilled,
        openSafety: active ? filled : null,
        avgEntry: active ? cost / qty : null,
      };
    },
  };
}

export function runMartingaleSimulation(
  candles: Candle[],
  funding: FundingRate[],
  intervalMs: number,
  p: MartingaleParams,
): StrategyResult[] {
  const startPrice = candles[0].open;
  const spot = p.market === "spot";
  const capital = spot ? p.investment / (1 + Math.max(p.makerFee, p.takerFee)) : p.investment * p.leverage;
  const { baseQuote } = martingaleLadder(capital, p);
  const config = (direction: 1 | -1): MartingaleConfig => ({
    direction,
    baseQuote,
    priceStep: p.priceStep,
    stepScale: p.stepScale,
    volumeScale: p.volumeScale,
    maxSafetyOrders: p.maxSafetyOrders,
    takeProfit: p.takeProfit,
    stopLoss: p.stopLoss > 0 ? p.stopLoss : null,
  });

  const runs: StrategyRun[] = spot
    ? [
        {
          id: "spot-hold",
          meta: HOLD_META.spot,
          strategy: holdStrategy(p.investment / (startPrice * (1 + p.takerFee))),
        },
        { id: "martingale-spot", meta: MARTINGALE_META["martingale-spot"], strategy: martingaleStrategy(config(1)) },
      ]
    : [
        { id: "futures-hold", meta: HOLD_META.futures, strategy: holdStrategy((p.investment * p.leverage) / startPrice) },
        { id: "martingale-long", meta: MARTINGALE_META["martingale-long"], strategy: martingaleStrategy(config(1)) },
        { id: "martingale-short", meta: MARTINGALE_META["martingale-short"], strategy: martingaleStrategy(config(-1)) },
      ];

  return runStrategies({ candles, funding, intervalMs, market: p.market, investment: p.investment, costs: p }, runs);
}

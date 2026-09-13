import type { Candle } from "@/lib/market/types";

// 技术指标：返回与输入等长的数组，数据不足的位置为 null

export type Series = (number | null)[];

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 指数移动平均，以前 period 个值的简单平均作为初值 */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    if (prev === null) {
      seed += values[i];
      if (i === period - 1) prev = seed / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

/** 平均真实波幅（Wilder 平滑） */
export function atr(candles: Candle[], period: number): Series {
  const out: Series = new Array(candles.length).fill(null);
  let prev: number | null = null;
  let seed = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const tr =
      i === 0
        ? c.high - c.low
        : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close));
    if (prev === null) {
      seed += tr;
      if (i === period - 1) prev = seed / period;
    } else {
      prev = (prev * (period - 1) + tr) / period;
    }
    out[i] = prev;
  }
  return out;
}

/** 唐奇安通道：不含当前K线的前 period 根最高价 / 最低价（单调队列，O(n)） */
export function donchian(candles: Candle[], period: number): { upper: Series; lower: Series } {
  const n = candles.length;
  const upper: Series = new Array(n).fill(null);
  const lower: Series = new Array(n).fill(null);
  const highs: number[] = [];
  const lows: number[] = [];
  let highHead = 0;
  let lowHead = 0;

  for (let i = 0; i < n; i++) {
    // 此时队列覆盖窗口 [i - period, i - 1]
    if (i >= period) {
      upper[i] = candles[highs[highHead]].high;
      lower[i] = candles[lows[lowHead]].low;
    }
    while (highs.length > highHead && candles[highs[highs.length - 1]].high <= candles[i].high) highs.pop();
    highs.push(i);
    while (lows.length > lowHead && candles[lows[lows.length - 1]].low >= candles[i].low) lows.pop();
    lows.push(i);
    // 移出下一根K线窗口之外的元素
    if (highs[highHead] <= i - period) highHead++;
    if (lows[lowHead] <= i - period) lowHead++;
  }
  return { upper, lower };
}

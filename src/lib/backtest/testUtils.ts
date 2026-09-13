import type { Candle } from "@/lib/market/types";

export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const T0 = Date.UTC(2025, 0, 1);

/** 按收盘价序列生成K线：每根开盘价为上一根收盘价，高低点为两者极值 */
export function candlesFromCloses(start: number, closes: number[], intervalMs = HOUR): Candle[] {
  let prev = start;
  return closes.map((close, i) => {
    const candle = {
      time: T0 + i * intervalMs,
      open: prev,
      high: Math.max(prev, close),
      low: Math.min(prev, close),
      close,
      volume: 0,
    };
    prev = close;
    return candle;
  });
}

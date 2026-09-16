"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadDataset } from "@/lib/market/client";
import { KLINE_INTERVALS, type Candle, type KlineInterval, type MarketType } from "@/lib/market/types";

// 模拟盘的实时K线：定时拉取最近若干根，两次拉取之间用实时价更新最后一根

const SYMBOL_RE = /^[A-Z0-9]{2,30}$/;
/** 图表显示的K线根数 */
const BARS = 240;
const REFETCH_MS = 60_000;

export interface LiveKlines {
  candles: Candle[];
  loading: boolean;
  error: string | null;
}

/** 用最新价更新最后一根K线；跨到新周期时补一根新的 */
function patchLastCandle(candles: Candle[], price: number, time: number, intervalMs: number): Candle[] {
  if (candles.length === 0 || !(price > 0)) return candles;
  const last = candles[candles.length - 1];
  const bucket = Math.floor(time / intervalMs) * intervalMs;
  if (bucket > last.time) {
    return [...candles, { time: bucket, open: price, high: price, low: price, close: price, volume: 0 }];
  }
  if (bucket < last.time || last.close === price) return candles;
  const updated: Candle = {
    ...last,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
    close: price,
  };
  return [...candles.slice(0, -1), updated];
}

export function useLiveKlines(
  market: MarketType,
  symbol: string,
  interval: KlineInterval,
  price: number | null,
  priceTime: number,
): LiveKlines {
  const [state, setState] = useState<{ key: string; candles: Candle[]; loading: boolean; error: string | null }>({
    key: "",
    candles: [],
    loading: true,
    error: null,
  });
  const busy = useRef(false);
  const key = `${market}|${symbol}|${interval}`;

  useEffect(() => {
    if (!SYMBOL_RE.test(symbol)) return;
    let stopped = false;
    const intervalMs = KLINE_INTERVALS[interval];

    const fetchBars = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const now = Date.now();
        const data = await loadDataset({ market, symbol, interval, start: now - BARS * intervalMs, end: now });
        if (!stopped) setState({ key, candles: data.candles, loading: false, error: null });
      } catch (err) {
        if (!stopped) setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
      } finally {
        busy.current = false;
      }
    };

    setState((s) => ({ ...s, loading: true, error: null }));
    fetchBars();
    const timer = setInterval(fetchBars, REFETCH_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [market, symbol, interval, key]);

  return useMemo(() => {
    // 拉到的K线属于当前参数时才显示，切换周期 / 币种时不闪旧数据
    const candles = state.key === key ? state.candles : [];
    return {
      candles:
        price === null ? candles : patchLastCandle(candles, price, priceTime || Date.now(), KLINE_INTERVALS[interval]),
      loading: state.loading && candles.length === 0,
      error: state.error,
    };
  }, [state, key, price, priceTime, interval]);
}

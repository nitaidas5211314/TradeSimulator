"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadTicker } from "@/lib/market/client";
import type { MarketType, Ticker } from "@/lib/market/types";

// 定时轮询本站 /api/ticker 获取 Binance 实时行情

const SYMBOL_RE = /^[A-Z0-9]{2,30}$/;

export interface LiveTicker {
  ticker: Ticker | null;
  error: string | null;
  loading: boolean;
  /** 浏览器收到最新行情的时间 */
  receivedAt: number;
  refresh: () => void;
}

export function useLiveTicker(market: MarketType, symbol: string, intervalMs: number): LiveTicker {
  const [state, setState] = useState<Omit<LiveTicker, "refresh">>({
    ticker: null,
    error: null,
    loading: true,
    receivedAt: 0,
  });
  const seq = useRef(0);
  const busy = useRef(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const id = ++seq.current;
    if (!SYMBOL_RE.test(symbol)) {
      setState({ ticker: null, error: "请输入正确的交易对，如 BTCUSDT", loading: false, receivedAt: 0 });
      return;
    }
    setState({ ticker: null, error: null, loading: true, receivedAt: 0 });

    const poll = async () => {
      // 上一次请求还没回来就跳过这一轮，避免堆积
      if (busy.current) return;
      busy.current = true;
      try {
        const ticker = await loadTicker(market, symbol);
        if (seq.current === id) setState({ ticker, error: null, loading: false, receivedAt: Date.now() });
      } catch (err) {
        // 出错时保留上一次价格，继续轮询等待恢复
        if (seq.current === id) setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
      } finally {
        busy.current = false;
      }
    };

    poll();
    const timer = setInterval(poll, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [market, symbol, intervalMs, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, refresh };
}

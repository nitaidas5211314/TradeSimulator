"use client";

import { useEffect, useRef } from "react";

// TradingView 官方 Advanced Chart 嵌入组件。
// 注意：嵌入版不支持锁定任意历史起止时间，只能设置周期和回看范围（range）。

export function TradingViewWidget({
  symbol,
  interval,
  range,
  height = 440,
}: {
  /** 如 BINANCE:BTCUSDT 或 BINANCE:BTCUSDT.P */
  symbol: string;
  /** TradingView 周期：1 / 5 / 15 / 60 / 240 / D */
  interval: string;
  /** 回看范围：1D / 5D / 1M / 3M / 6M / 12M / 60M / ALL */
  range: string;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current!;
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      range,
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "zh_CN",
      backgroundColor: "#161a1e",
      gridColor: "rgba(43,49,57,0.6)",
      allow_symbol_change: true,
      save_image: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });

    container.replaceChildren(widget, script);
    return () => container.replaceChildren();
  }, [symbol, interval, range]);

  // autosize 模式下嵌入脚本会把容器设为 height: 100%，所以固定高度要放在外层
  return (
    <div className="w-full" style={{ height }}>
      <div ref={containerRef} className="tradingview-widget-container h-full w-full" />
    </div>
  );
}

export function toTradingViewInterval(interval: string) {
  return ({ "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D" } as Record<string, string>)[interval] ?? "60";
}

/** 选择能覆盖回测起点至今的最小回看范围 */
export function toTradingViewRange(startMs: number) {
  const days = (Date.now() - startMs) / 86_400_000;
  const options: [number, string][] = [
    [1, "1D"],
    [5, "5D"],
    [31, "1M"],
    [92, "3M"],
    [183, "6M"],
    [366, "12M"],
    [1830, "60M"],
  ];
  return options.find(([limit]) => days <= limit)?.[1] ?? "ALL";
}

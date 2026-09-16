"use client";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import { pricePrecision } from "@/lib/format";
import type { Candle } from "@/lib/market/types";
import type { TimeScaleSync } from "./timeScaleSync";

export interface TradeMarker {
  time: number;
  side: "buy" | "sell";
  count: number;
  /** 关键成交的文字（如 建仓 / 止盈 / 强平），null 显示 B / S */
  label: string | null;
}

/** 带标题的水平线，如挂单价、持仓均价 */
export interface PriceLine {
  price: number;
  color: string;
  title: string;
}

/** 叠加在价格上的指标线（如均线、通道），values 与 candles 一一对应 */
export interface KlineOverlay {
  id: string;
  color: string;
  values: (number | null)[];
}

export const CHART_THEME = {
  layout: {
    background: { type: ColorType.Solid, color: "transparent" },
    textColor: "#848e9c",
    fontSize: 11,
  },
  grid: { vertLines: { color: "#1e2329" }, horzLines: { color: "#1e2329" } },
  rightPriceScale: { borderColor: "#2b3139" },
  // 默认最小柱间距 0.5px 会让上万根K线无法完整显示，调小以便 fitContent 显示全区间
  timeScale: { borderColor: "#2b3139", timeVisible: true, secondsVisible: false, minBarSpacing: 0.01 },
  crosshair: { mode: CrosshairMode.Normal },
  localization: { locale: "zh-CN", dateFormat: "yyyy-MM-dd" },
} as const;

const UP = "#0ecb81";
const DOWN = "#f6465d";
const ACCENT = "#f0b90b";
/** 网格线过多时只画上下限，避免图表卡顿 */
const MAX_GRID_LINES = 200;
const NO_LEVELS: number[] = [];
const NO_PRICE_LINES: PriceLine[] = [];
const NO_OVERLAYS: KlineOverlay[] = [];

const toTime = (ms: number) => (ms / 1000) as UTCTimestamp;
const toBar = (c: Candle) => ({ time: toTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close });
const toVolume = (c: Candle) => ({
  time: toTime(c.time),
  value: c.volume,
  color: c.close >= c.open ? "rgba(14,203,129,0.35)" : "rgba(246,70,93,0.35)",
});

export function KlineChart({
  candles,
  levels = NO_LEVELS,
  markers,
  priceLines = NO_PRICE_LINES,
  overlays = NO_OVERLAYS,
  sync,
  height = 440,
}: {
  candles: Candle[];
  levels?: number[];
  markers: TradeMarker[];
  priceLines?: PriceLine[];
  overlays?: KlineOverlay[];
  sync?: TimeScaleSync;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const levelLinesRef = useRef<IPriceLine[]>([]);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const renderedRef = useRef<Candle[] | null>(null);
  const overlaySeriesRef = useRef<ISeriesApi<"Line">[]>([]);

  useEffect(() => {
    const chart = createChart(containerRef.current!, { ...CHART_THEME, autoSize: true });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    markersRef.current = createSeriesMarkers(candleSeries, []);
    const unsync = sync?.add(chart);

    return () => {
      unsync?.();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      markersRef.current = null;
      levelLinesRef.current = [];
      priceLinesRef.current = [];
      renderedRef.current = null;
      overlaySeriesRef.current = [];
    };
  }, [sync]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    const volume = volumeSeriesRef.current;
    if (!series || !volume || candles.length === 0) return;
    const previous = renderedRef.current;
    renderedRef.current = candles;

    // 复盘逐根追加、模拟盘最后一根随实时价变化：增量更新，保持当前缩放位置
    if (
      previous &&
      previous.length > 1 &&
      candles.length >= previous.length &&
      candles[previous.length - 2] === previous[previous.length - 2]
    ) {
      for (let i = previous.length - 1; i < candles.length; i++) {
        series.update(toBar(candles[i]));
        volume.update(toVolume(candles[i]));
      }
      return;
    }

    const precision = pricePrecision(candles[0].open);
    series.applyOptions({ priceFormat: { type: "price", precision, minMove: Math.pow(10, -precision) } });
    series.setData(candles.map(toBar));
    volume.setData(candles.map(toVolume));
    if (sync) sync.fit();
    else chartRef.current?.timeScale().fitContent();
  }, [candles, sync]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    for (const line of levelLinesRef.current) series.removePriceLine(line);
    levelLinesRef.current = [];
    if (levels.length < 2) return;

    const drawAll = levels.length <= MAX_GRID_LINES + 1;
    levels.forEach((price, i) => {
      const edge = i === 0 || i === levels.length - 1;
      if (!edge && !drawAll) return;
      levelLinesRef.current.push(
        series.createPriceLine({
          price,
          color: edge ? ACCENT : "rgba(240,185,11,0.22)",
          lineWidth: 1,
          lineStyle: edge ? LineStyle.Solid : LineStyle.Dashed,
          axisLabelVisible: edge,
          title: edge ? (i === 0 ? "下限" : "上限") : "",
        }),
      );
    });
  }, [levels, sync]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = priceLines.map((p) =>
      series.createPriceLine({
        price: p.price,
        color: p.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: p.title,
      }),
    );
  }, [priceLines, sync]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of overlaySeriesRef.current) chart.removeSeries(s);
    overlaySeriesRef.current = [];
    for (const overlay of overlays) {
      if (overlay.values.length !== candles.length) continue;
      const line = chart.addSeries(LineSeries, {
        color: overlay.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      line.setData(
        candles.map((c, i) => {
          const value = overlay.values[i];
          return value === null ? { time: toTime(c.time) } : { time: toTime(c.time), value };
        }),
      );
      overlaySeriesRef.current.push(line);
    }
  }, [overlays, candles, sync]);

  useEffect(() => {
    markersRef.current?.setMarkers(
      markers.map((m) => {
        const buy = m.side === "buy";
        const label = m.label ?? (buy ? "B" : "S");
        return {
          time: toTime(m.time),
          position: buy ? "belowBar" : "aboveBar",
          shape: buy ? "arrowUp" : "arrowDown",
          color: m.label === "强平" ? "#ffffff" : buy ? UP : DOWN,
          text: m.count > 1 ? `${label}×${m.count}` : label,
          size: m.label ? 1 : 0.6,
        };
      }),
    );
  }, [markers, sync]);

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}

"use client";

import {
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { fmtDateTime } from "@/lib/format";
import { CHART_THEME } from "./KlineChart";
import type { TimeScaleSync } from "./timeScaleSync";

export interface IndicatorSeries {
  id: string;
  name: string;
  color: string;
  /** 与 times 一一对应，null 表示该点无数据 */
  values: (number | null)[];
  /** 使用左侧价格轴（量级不同的两组数据分开显示） */
  left?: boolean;
  format: (value: number) => string;
}

const toTime = (ms: number) => (ms / 1000) as UTCTimestamp;

/** 通用指标折线图；数据点与K线逐根对齐时可与其他图表同步时间轴 */
export function IndicatorChart({
  times,
  series,
  sync,
  height = 220,
}: {
  times: number[];
  series: IndicatorSeries[];
  sync?: TimeScaleSync;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line">[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    const chart = createChart(containerRef.current!, {
      ...CHART_THEME,
      autoSize: true,
      leftPriceScale: { borderColor: "#2b3139" },
    });
    chartRef.current = chart;
    const unsync = sync?.add(chart);
    const onMove = (param: MouseEventParams<Time>) => {
      setHoverIndex(param.time === undefined || param.logical === undefined ? null : Math.round(param.logical));
    };
    chart.subscribeCrosshairMove(onMove);

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      unsync?.();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = [];
    };
  }, [sync]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of seriesRef.current) chart.removeSeries(s);
    seriesRef.current = [];
    chart.applyOptions({ leftPriceScale: { visible: series.some((s) => s.left) } });

    for (const s of series) {
      const line = chart.addSeries(LineSeries, {
        color: s.color,
        lineWidth: 2,
        priceScaleId: s.left ? "left" : "right",
        priceLineVisible: false,
        priceFormat: { type: "custom", formatter: s.format, minMove: 1e-8 },
      });
      line.setData(
        times.map((t, i) => {
          const value = s.values[i];
          return value === null ? { time: toTime(t) } : { time: toTime(t), value };
        }),
      );
      seriesRef.current.push(line);
    }
    if (sync) sync.fit();
    else chart.timeScale().fitContent();
  }, [times, series, sync]);

  const count = times.length;
  const index = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < count ? hoverIndex : count - 1;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3 text-xs">
        {series.map((s) => {
          const value = s.values[index];
          return (
            <span key={s.id} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="text-muted">{s.name}</span>
              <span className="num">{value === null || value === undefined ? "—" : s.format(value)}</span>
            </span>
          );
        })}
        {count > 0 && (
          <span className="num ml-auto text-muted">
            {hoverIndex === null ? "期末 " : ""}
            {fmtDateTime(times[index])} UTC
          </span>
        )}
      </div>
      <div ref={containerRef} style={{ height }} className="w-full" />
    </div>
  );
}

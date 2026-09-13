"use client";

import {
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { StrategyId, StrategyResult } from "@/lib/backtest/grid";
import { fmtDateTime, fmtPct, pnlClass } from "@/lib/format";
import { CHART_THEME } from "./KlineChart";
import type { TimeScaleSync } from "./timeScaleSync";

const toTime = (ms: number) => (ms / 1000) as UTCTimestamp;
const pctFormat = { type: "custom" as const, formatter: (v: number) => `${v.toFixed(2)}%`, minMove: 0.01 };

export function EquityChart({
  results,
  hidden,
  onToggle,
  sync,
  height = 320,
}: {
  results: StrategyResult[];
  hidden: ReadonlySet<StrategyId>;
  onToggle: (id: StrategyId) => void;
  sync?: TimeScaleSync;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef(new Map<StrategyId, ISeriesApi<"Line">>());
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    const chart = createChart(containerRef.current!, {
      ...CHART_THEME,
      autoSize: true,
      localization: { ...CHART_THEME.localization, priceFormatter: (v: number) => `${v.toFixed(2)}%` },
    });
    chartRef.current = chart;
    const unsync = sync?.add(chart);

    const onMove = (param: MouseEventParams<Time>) => {
      setHoverIndex(param.time === undefined || param.logical === undefined ? null : Math.round(param.logical));
    };
    chart.subscribeCrosshairMove(onMove);
    const series = seriesRef.current;

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      unsync?.();
      chart.remove();
      chartRef.current = null;
      series.clear();
    };
  }, [sync]);

  // 结果变化时重建所有曲线
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const seriesMap = seriesRef.current;
    for (const s of seriesMap.values()) chart.removeSeries(s);
    seriesMap.clear();
    if (results.length === 0) return;

    const investment = results[0].initialEquity;
    const baseline = chart.addSeries(LineSeries, {
      color: "#474d57",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: pctFormat,
    });
    baseline.setData(results[0].equity.map((p) => ({ time: toTime(p.time), value: 0 })));

    for (const r of results) {
      const series = chart.addSeries(LineSeries, {
        color: r.color,
        lineWidth: 2,
        priceLineVisible: false,
        title: "",
        priceFormat: pctFormat,
      });
      series.setData(r.equity.map((p) => ({ time: toTime(p.time), value: (p.equity / investment - 1) * 100 })));
      if (r.liquidation) {
        createSeriesMarkers(series, [
          { time: toTime(r.liquidation.time), position: "aboveBar", shape: "circle", color: r.color, text: "爆仓" },
        ]);
      }
      seriesMap.set(r.id, series);
    }
    // 基准线也放进 map 以便统一清理
    seriesMap.set("__baseline" as StrategyId, baseline);
    if (sync) sync.fit();
    else chart.timeScale().fitContent();
  }, [results, sync]);

  useEffect(() => {
    for (const [id, series] of seriesRef.current) {
      if (id !== ("__baseline" as StrategyId)) series.applyOptions({ visible: !hidden.has(id) });
    }
  }, [hidden, results, sync]);

  const pointCount = results[0]?.equity.length ?? 0;
  const index = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < pointCount ? hoverIndex : pointCount - 1;
  const hoverTime = results[0]?.equity[index]?.time;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        {results.map((r) => {
          const point = r.equity[index];
          const ret = point ? point.equity / r.initialEquity - 1 : 0;
          const off = hidden.has(r.id);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onToggle(r.id)}
              title={`${r.description}（点击显示/隐藏）`}
              className={`flex items-center gap-2 rounded border px-2.5 py-1 text-xs transition-opacity ${
                off ? "border-line opacity-40" : "border-line bg-panel-2"
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
              <span>{r.name}</span>
              <span className={`num ${pnlClass(ret)}`}>{fmtPct(ret)}</span>
            </button>
          );
        })}
        {hoverTime !== undefined && (
          <span className="num ml-auto text-xs text-muted">
            {hoverIndex === null ? "期末 " : ""}
            {fmtDateTime(hoverTime)} UTC
          </span>
        )}
      </div>
      <div ref={containerRef} style={{ height }} className="w-full" />
    </div>
  );
}

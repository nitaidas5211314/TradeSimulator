"use client";

import { useCallback, useMemo, useState } from "react";
import { EquityChart } from "@/components/charts/EquityChart";
import { KlineChart, type TradeMarker } from "@/components/charts/KlineChart";
import { createTimeScaleSync } from "@/components/charts/timeScaleSync";
import { TradingViewWidget, toTradingViewInterval, toTradingViewRange } from "@/components/charts/TradingViewWidget";
import { Card, Segmented } from "@/components/ui/controls";
import type { StrategyResult } from "@/lib/backtest/common";
import type { TradeAction } from "@/lib/backtest/engine";
import { DatasetSummary } from "./DatasetSummary";
import { StatsTable, type StatColumn } from "./StatsTable";
import { TradesTable } from "./TradesTable";
import type { MarketDataState } from "./useMarketData";

const NO_LEVELS: number[] = [];
const NO_COLUMNS: StatColumn[] = [];

// 关键成交在K线上显示文字，其余显示 B / S
const MARKER_LABEL: Partial<Record<TradeAction, string>> = {
  init: "建仓",
  takeProfit: "止盈",
  stopLoss: "止损",
  liquidation: "强平",
};

/** 行情概览、K线与 TradingView、收益曲线、指标对比、成交明细 */
export function ResultsPanel({
  data,
  results,
  levels = NO_LEVELS,
  columns = NO_COLUMNS,
  message,
  defaultSelectedId,
}: {
  data: MarketDataState;
  results: StrategyResult[] | null;
  /** K线图上的水平价格线（如网格线） */
  levels?: number[];
  columns?: StatColumn[];
  /** 无结果时收益曲线处显示的提示（如参数校验错误） */
  message?: string | null;
  defaultSelectedId?: string;
}) {
  const { dataset, loading, error, stale } = data;
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [chartTab, setChartTab] = useState<"kline" | "tradingview">("kline");
  const [tvMounted, setTvMounted] = useState(false);
  const [showMarkers, setShowMarkers] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sync] = useState(createTimeScaleSync);

  const selected =
    results?.find((r) => r.id === selectedId) ??
    results?.find((r) => r.id === defaultSelectedId) ??
    results?.[0] ??
    null;

  const markers = useMemo<TradeMarker[]>(() => {
    if (!selected || !showMarkers) return [];
    const map = new Map<string, TradeMarker>();
    for (const t of selected.trades) {
      const label = MARKER_LABEL[t.action] ?? null;
      const key = `${t.time}|${t.side}|${label}`;
      const existing = map.get(key);
      if (existing) existing.count++;
      else map.set(key, { time: t.time, side: t.side, count: 1, label });
    }
    return [...map.values()].sort((a, b) => a.time - b.time);
  }, [selected, showMarkers]);

  const toggleStrategy = useCallback((id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const tvSymbol = dataset ? `BINANCE:${dataset.symbol}${dataset.market === "futures" ? ".P" : ""}` : "";

  return (
    <>
      {error && (
        <div className="rounded-lg border border-down/40 bg-down/10 px-4 py-2.5 text-sm text-down">加载失败：{error}</div>
      )}
      {dataset && stale && !loading && (
        <div className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-xs text-accent">
          行情参数已修改，下方仍是 {dataset.symbol} 旧数据的回测结果，点击左侧「加载行情并回测」更新。
        </div>
      )}

      <DatasetSummary dataset={dataset} loading={loading} />

      <Card
        title={
          <Segmented
            size="sm"
            value={chartTab}
            onChange={(tab) => {
              setChartTab(tab);
              if (tab === "tradingview") setTvMounted(true);
            }}
            options={[
              { value: "kline", label: "回测K线" },
              { value: "tradingview", label: "TradingView" },
            ]}
          />
        }
        extra={
          chartTab === "kline" &&
          results && (
            <div className="flex items-center gap-3 text-xs text-muted">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showMarkers}
                  onChange={(e) => setShowMarkers(e.target.checked)}
                  className="accent-[#f0b90b]"
                />
                成交标记
              </label>
              <select
                className="h-6 rounded border border-line bg-panel-2 px-1 text-xs text-fg"
                value={selected?.id}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {results.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          )
        }
      >
        <div hidden={chartTab !== "kline"}>
          {dataset ? (
            <KlineChart candles={dataset.candles} levels={levels} markers={markers} sync={sync} />
          ) : (
            <ChartPlaceholder height={440} loading={loading} />
          )}
        </div>
        {tvMounted && dataset && (
          <div hidden={chartTab !== "tradingview"}>
            <TradingViewWidget
              symbol={tvSymbol}
              interval={toTradingViewInterval(dataset.interval)}
              range={toTradingViewRange(dataset.start)}
            />
            <p className="border-t border-line px-4 py-2 text-[11px] text-muted">
              TradingView 嵌入组件不支持锁定任意历史起止时间，已按回测起点设置回看范围，可自行缩放到对应时间段；
              精确的回测区间和成交点请看「回测K线」（同样基于 TradingView Lightweight Charts）。
            </p>
          </div>
        )}
      </Card>

      <Card
        title="收益曲线对比"
        extra={<span className="text-xs text-muted">纵轴为相对投入资金的收益率，与K线图时间轴联动</span>}
      >
        {results ? (
          <EquityChart results={results} hidden={hidden} onToggle={toggleStrategy} sync={sync} />
        ) : (
          <ChartPlaceholder height={360} loading={loading} message={message ?? undefined} />
        )}
      </Card>

      {results && (
        <>
          <Card title="策略指标对比">
            <StatsTable results={results} futures={dataset?.market === "futures"} columns={columns} />
          </Card>

          {selected && (
            <Card
              title="成交明细"
              extra={
                <Segmented
                  size="sm"
                  value={selected.id}
                  onChange={setSelectedId}
                  options={results.map((r) => ({ value: r.id, label: r.name }))}
                />
              }
            >
              <TradesTable result={selected} />
            </Card>
          )}
        </>
      )}
    </>
  );
}

function ChartPlaceholder({ height, loading, message }: { height: number; loading: boolean; message?: string }) {
  return (
    <div style={{ height }} className="flex items-center justify-center text-sm text-muted">
      {message ?? (loading ? "加载中…" : "暂无数据")}
    </div>
  );
}

"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { EquityChart } from "@/components/charts/EquityChart";
import { KlineChart, type TradeMarker } from "@/components/charts/KlineChart";
import { createTimeScaleSync } from "@/components/charts/timeScaleSync";
import { TradingViewWidget, toTradingViewInterval, toTradingViewRange } from "@/components/charts/TradingViewWidget";
import { Card, Segmented } from "@/components/ui/controls";
import {
  buildGridLevels,
  gridProfitRange,
  runGridSimulation,
  validateParams,
  type SimulationParams,
  type StrategyId,
} from "@/lib/backtest/grid";
import { fmtDateTime, fmtPct, fmtPrice, pnlClass, roundPrice } from "@/lib/format";
import { loadDataset, loadSymbols, type DatasetRequest, type MarketDataset } from "@/lib/market/client";
import { KLINE_INTERVALS, type MarketType, type SymbolInfo } from "@/lib/market/types";
import { buildRequest, createDefaultForm, toSimParams, type FormState } from "./form";
import { ParamsPanel, type GridInfo } from "./ParamsPanel";
import { StatsTable } from "./StatsTable";
import { TradesTable } from "./TradesTable";

interface LoadedDataset extends MarketDataset {
  /** 加载时的表单行情参数，用于判断是否需要重新加载 */
  formKey: string;
}

const formKeyOf = (f: FormState) => [f.market, f.symbol, f.startDate, f.endDate, f.interval].join("|");

const percentRange = (price: number) => ({
  lower: String(roundPrice(price * 0.85)),
  upper: String(roundPrice(price * 1.15)),
});

export default function GridSimulator() {
  const [form, setForm] = useState<FormState>(() => createDefaultForm());
  const patchForm = useCallback((patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch })), []);
  const [symbols, setSymbols] = useState<Partial<Record<MarketType, SymbolInfo[]>>>({});
  const [dataset, setDataset] = useState<LoadedDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<StrategyId>>(() => new Set());
  const [chartTab, setChartTab] = useState<"kline" | "tradingview">("kline");
  const [tvMounted, setTvMounted] = useState(false);
  const [showMarkers, setShowMarkers] = useState(true);
  const [selectedId, setSelectedId] = useState<StrategyId | null>(null);
  const [sync] = useState(createTimeScaleSync);
  const loadSeq = useRef(0);
  const datasetRef = useRef<LoadedDataset | null>(null);
  const symbolsRequested = useRef(new Set<MarketType>());

  const requestInfo = useMemo(() => buildRequest(form), [form]);
  const formKey = formKeyOf(form);
  const stale = !dataset || dataset.formKey !== formKey;

  const applyLoaded = useCallback((seq: number, key: string, data: MarketDataset) => {
    if (seq !== loadSeq.current) return;
    setLoading(false);
    const prev = datasetRef.current;
    const assetChanged = !prev || prev.symbol !== data.symbol || prev.market !== data.market;
    const loaded = { ...data, formKey: key };
    datasetRef.current = loaded;
    setDataset(loaded);
    // 首次加载、换币种或当前区间不包含开盘价时，自动设置网格区间
    setForm((f) => {
      const p0 = data.candles[0].open;
      const lower = Number(f.lower);
      const upper = Number(f.upper);
      const contains = lower > 0 && upper > lower && p0 > lower && p0 < upper;
      return contains && !assetChanged ? f : { ...f, ...percentRange(p0) };
    });
  }, []);

  const applyFailed = useCallback((seq: number, err: unknown) => {
    if (seq !== loadSeq.current) return;
    setLoading(false);
    setError((err as Error).message);
  }, []);

  const load = (request: DatasetRequest, key: string) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    loadDataset(request).then(
      (data) => applyLoaded(seq, key, data),
      (err) => applyFailed(seq, err),
    );
  };

  // 首次进入自动加载默认行情（loading 初始即为 true）
  useEffect(() => {
    const initial = createDefaultForm();
    const info = buildRequest(initial);
    if (!info.request) return;
    const seq = ++loadSeq.current;
    loadDataset(info.request).then(
      (data) => applyLoaded(seq, formKeyOf(initial), data),
      (err) => applyFailed(seq, err),
    );
  }, [applyLoaded, applyFailed]);

  useEffect(() => {
    const market = form.market;
    if (symbolsRequested.current.has(market)) return;
    symbolsRequested.current.add(market);
    loadSymbols(market)
      .then((list) => setSymbols((s) => ({ ...s, [market]: list })))
      .catch(() => symbolsRequested.current.delete(market));
  }, [form.market]);

  // 回测参数序列化为 key，只有参数真正变化时才重新回测
  const simParams = dataset ? toSimParams(form, dataset.market) : null;
  const validationError = simParams ? validateParams(simParams) : null;
  const paramsKey = simParams && !validationError ? JSON.stringify(simParams) : "";
  const deferredKey = useDeferredValue(paramsKey);
  const deferredDataset = useDeferredValue(dataset);

  const simulation = useMemo(() => {
    if (!deferredDataset || !deferredKey) return null;
    const params = JSON.parse(deferredKey) as SimulationParams;
    if (params.market !== deferredDataset.market) return null;
    const results = runGridSimulation(
      deferredDataset.candles,
      deferredDataset.funding,
      KLINE_INTERVALS[deferredDataset.interval],
      params,
    );
    return { results, levels: buildGridLevels(params.lower, params.upper, params.gridCount, params.gridMode) };
  }, [deferredDataset, deferredKey]);

  const gridInfo = useMemo<GridInfo | null>(() => {
    if (!paramsKey) return null;
    const p = JSON.parse(paramsKey) as SimulationParams;
    const range = gridProfitRange(buildGridLevels(p.lower, p.upper, p.gridCount, p.gridMode), p.makerFee);
    return { profitMin: range.min, profitMax: range.max };
  }, [paramsKey]);

  const results = simulation?.results ?? null;
  const selected =
    results?.find((r) => r.id === selectedId) ?? results?.find((r) => r.id.endsWith("grid")) ?? results?.[0] ?? null;

  const markers = useMemo<TradeMarker[]>(() => {
    if (!selected || !showMarkers) return [];
    const map = new Map<string, TradeMarker>();
    for (const t of selected.trades) {
      const kind = t.action === "init" ? "init" : t.action === "liquidation" ? "liquidation" : "grid";
      const key = `${t.time}|${t.side}|${kind}`;
      const existing = map.get(key);
      if (existing) existing.count++;
      else map.set(key, { time: t.time, side: t.side, count: 1, kind });
    }
    return [...map.values()].sort((a, b) => a.time - b.time);
  }, [selected, showMarkers]);

  const summary = useMemo(() => {
    if (!dataset) return null;
    const { candles, funding } = dataset;
    let high = -Infinity;
    let low = Infinity;
    for (const c of candles) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
    }
    const first = candles[0];
    const last = candles[candles.length - 1];
    return {
      first,
      last,
      high,
      low,
      change: last.close / first.open - 1,
      fundingSum: funding.reduce((sum, f) => sum + f.rate, 0),
    };
  }, [dataset]);

  const onRangePreset = (kind: "percent" | "extremes") => {
    if (!summary) return;
    patchForm(
      kind === "percent"
        ? percentRange(summary.first.open)
        : { lower: String(roundPrice(summary.low)), upper: String(roundPrice(summary.high)) },
    );
  };

  const toggleStrategy = useCallback((id: StrategyId) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const tvSymbol = dataset ? `BINANCE:${dataset.symbol}${dataset.market === "futures" ? ".P" : ""}` : "";

  return (
    <div className="mx-auto grid w-full max-w-[1680px] gap-4 p-4 lg:grid-cols-[330px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto">
        <ParamsPanel
          form={form}
          onChange={patchForm}
          symbols={symbols[form.market] ?? []}
          requestInfo={requestInfo}
          loading={loading}
          stale={stale}
          onLoad={() => requestInfo.request && load(requestInfo.request, formKey)}
          gridInfo={gridInfo}
          validationError={validationError}
          startPrice={summary?.first.open ?? null}
          onRangePreset={onRangePreset}
        />
      </aside>

      <main className="min-w-0 space-y-4">
        {error && (
          <div className="rounded-lg border border-down/40 bg-down/10 px-4 py-2.5 text-sm text-down">加载失败：{error}</div>
        )}
        {dataset && stale && !loading && (
          <div className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-xs text-accent">
            行情参数已修改，下方仍是 {dataset.symbol} 旧数据的回测结果，点击左侧「加载行情并回测」更新。
          </div>
        )}

        {dataset && summary ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-panel px-4 py-3 text-xs">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-semibold">{dataset.symbol}</span>
              <span className="rounded bg-panel-2 px-1.5 py-0.5 text-muted">
                {dataset.market === "spot" ? "现货" : "U本位永续"}
              </span>
            </div>
            <Stat label="区间 (UTC)" value={`${fmtDateTime(summary.first.time)} ~ ${fmtDateTime(summary.last.time)}`} />
            <Stat label="周期" value={`${dataset.interval} · ${dataset.candles.length.toLocaleString()} 根`} />
            <Stat label="开盘 → 收盘" value={`${fmtPrice(summary.first.open)} → ${fmtPrice(summary.last.close)}`} />
            <Stat label="区间涨跌" value={fmtPct(summary.change)} className={pnlClass(summary.change)} />
            <Stat label="最高 / 最低" value={`${fmtPrice(summary.high)} / ${fmtPrice(summary.low)}`} />
            {dataset.market === "futures" && (
              <Stat
                label="累计资金费率"
                value={`${fmtPct(summary.fundingSum, true, 3)}（${dataset.funding.length} 次）`}
                className={pnlClass(-summary.fundingSum)}
              />
            )}
            {summary.first.time > dataset.start + KLINE_INTERVALS[dataset.interval] && (
              <span className="text-accent">数据起始晚于所选日期（交易对上线较晚）</span>
            )}
            {dataset.source === "archive" && (
              <span className="basis-full text-[11px] leading-relaxed text-accent">
                合约行情接口在服务器所在地区不可用，已改用 Binance 官方历史归档 data.binance.vision，数据最新至昨日（UTC）
                {dataset.fundingEstimatedFrom !== null &&
                  `；${fmtDateTime(dataset.fundingEstimatedFrom)} 起的资金费率尚未归档，按溢价指数公式估算`}
                。
              </span>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-panel px-4 py-3 text-xs text-muted">
            {loading ? "正在从 Binance 加载行情…" : "请在左侧选择参数并加载行情"}
          </div>
        )}

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
                  onChange={(e) => setSelectedId(e.target.value as StrategyId)}
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
              <KlineChart candles={dataset.candles} levels={simulation?.levels ?? []} markers={markers} sync={sync} />
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
                精确的回测区间、网格线和成交点请看「回测K线」（同样基于 TradingView Lightweight Charts）。
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
            <ChartPlaceholder height={360} loading={loading} message={validationError ?? undefined} />
          )}
        </Card>

        {results && (
          <>
            <Card title="策略指标对比">
              <StatsTable results={results} futures={dataset?.market === "futures"} />
            </Card>

            {selected && (
              <Card
                title="成交明细"
                extra={
                  <Segmented<StrategyId>
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
      </main>
    </div>
  );
}

function Stat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted">{label}</span>
      <span className={`num text-fg ${className}`}>{value}</span>
    </div>
  );
}

function ChartPlaceholder({ height, loading, message }: { height: number; loading: boolean; message?: string }) {
  return (
    <div style={{ height }} className="flex items-center justify-center text-sm text-muted">
      {message ?? (loading ? "加载中…" : "暂无数据")}
    </div>
  );
}

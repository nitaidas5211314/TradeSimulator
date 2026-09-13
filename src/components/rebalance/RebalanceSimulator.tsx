"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IndicatorChart, type IndicatorSeries } from "@/components/charts/IndicatorChart";
import { CostSections } from "@/components/simulator/CostSections";
import { DEFAULT_COST_FORM, parseNum, toCostParams, type CostForm } from "@/components/simulator/costForm";
import { MarketDataSection, type DatePresetOption } from "@/components/simulator/MarketDataSection";
import { createMarketForm } from "@/components/simulator/marketForm";
import { ResultsPanel } from "@/components/simulator/ResultsPanel";
import { SimulatorLayout, ValidationMessage } from "@/components/simulator/SimulatorLayout";
import { statCell, type StatColumn } from "@/components/simulator/StatsTable";
import { useMarketData, type LoadedDataset } from "@/components/simulator/useMarketData";
import { useSimulation } from "@/components/simulator/useSimulation";
import { Card, Field, NumberInput, Section, Segmented, SmallButton, inputClass } from "@/components/ui/controls";
import { DCA_PERIOD_LABEL, type DcaPeriod } from "@/lib/backtest/dca";
import {
  MAX_ASSETS,
  runRebalanceSimulation,
  validateRebalanceParams,
  type RebalanceParams,
} from "@/lib/backtest/rebalance";
import { fmtDateTime, fmtPct, pnlClass } from "@/lib/format";
import { loadPortfolioDataset, type DatasetRequest, type PortfolioDataset } from "@/lib/market/client";
import { KLINE_INTERVALS } from "@/lib/market/types";

interface AssetRow {
  symbol: string;
  /** 百分比 */
  weight: string;
}

interface RebalanceForm {
  investment: string;
  assets: AssetRow[];
  period: DcaPeriod;
  /** 百分比 */
  threshold: string;
}

const DEFAULT_FORM: RebalanceForm = {
  investment: "10000",
  assets: [
    { symbol: "BTCUSDT", weight: "40" },
    { symbol: "ETHUSDT", weight: "30" },
    { symbol: "SOLUSDT", weight: "10" },
  ],
  period: "week",
  threshold: "5",
};

const DATE_PRESETS: DatePresetOption[] = [
  { days: 90, label: "90天" },
  { days: 180, label: "半年" },
  { days: 365, label: "1年" },
  { days: 730, label: "2年" },
  { days: 1095, label: "3年" },
];

const LINE_COLORS = ["#f0b90b", "#3b82f6", "#22c55e", "#ef4444", "#a855f7"];

const COLUMNS: StatColumn[] = [
  { key: "rebalances", label: "再平衡次数", cell: (r) => statCell.count(r.metrics.rebalances) },
  {
    key: "turnover",
    label: "换手率",
    title: "再平衡累计成交额 / 投入资金",
    cell: (r) => (typeof r.metrics.turnover === "number" ? { text: fmtPct(r.metrics.turnover, false, 1) } : statCell.dash),
  },
  { key: "cash", label: "期末 USDT", cell: (r) => statCell.usd(r.metrics.cash) },
];

const normalizeSymbol = (symbol: string) => symbol.trim().toUpperCase();

function runRebalance(dataset: LoadedDataset<PortfolioDataset>, params: RebalanceParams) {
  return runRebalanceSimulation(dataset, KLINE_INTERVALS[dataset.interval], params);
}

export default function RebalanceSimulator() {
  const [form, setForm] = useState<RebalanceForm>(DEFAULT_FORM);
  const [costForm, setCostForm] = useState<CostForm>(DEFAULT_COST_FORM);
  const patchForm = useCallback((patch: Partial<RebalanceForm>) => setForm((f) => ({ ...f, ...patch })), []);
  const patchCost = useCallback((patch: Partial<CostForm>) => setCostForm((f) => ({ ...f, ...patch })), []);
  const updateAsset = (index: number, patch: Partial<AssetRow>) =>
    setForm((f) => ({ ...f, assets: f.assets.map((a, i) => (i === index ? { ...a, ...patch } : a)) }));

  const symbols = form.assets.map((a) => normalizeSymbol(a.symbol));
  // 加载函数须保持稳定引用，通过 ref 读取最新的资产列表
  const symbolsRef = useRef(symbols);
  useEffect(() => {
    symbolsRef.current = symbols;
  });
  const [loader] = useState(() => (request: DatasetRequest) => loadPortfolioDataset(request, symbolsRef.current));

  const data = useMarketData<PortfolioDataset>({
    initialForm: () => createMarketForm({ market: "spot", days: 365, interval: "4h" }),
    loader,
  });
  const { dataset } = data;
  const portfolioChanged = dataset !== null && dataset.symbols.join(",") !== symbols.join(",");
  const view = { ...data, stale: data.stale || portfolioChanged };

  const fee = toCostParams(costForm, "spot").takerFee;
  const weightOf = (symbol: string) => {
    const row = form.assets.find((a) => normalizeSymbol(a.symbol) === symbol);
    return row ? parseNum(row.weight) / 100 : NaN;
  };
  const formParams: RebalanceParams = {
    investment: parseNum(form.investment),
    assets: symbols.map((symbol) => ({ symbol, weight: weightOf(symbol) })),
    period: form.period,
    threshold: parseNum(form.threshold) / 100,
    fee,
  };
  const validationError = validateRebalanceParams(formParams);
  // 回测使用已加载数据中的资产，权重取表单中同名资产
  const params: RebalanceParams | null =
    dataset && !portfolioChanged
      ? { ...formParams, assets: dataset.symbols.map((symbol) => ({ symbol, weight: weightOf(symbol) })) }
      : null;
  const results = useSimulation(dataset, validationError || !params ? null : params, runRebalance);

  const totalWeight = form.assets.reduce((sum, a) => sum + (parseNum(a.weight) || 0), 0);

  const priceLines = useMemo(() => {
    if (!dataset) return null;
    const series: IndicatorSeries[] = dataset.symbols.map((symbol, i) => {
      const candles = dataset.assetCandles[i];
      const base = candles[0].open;
      return {
        id: symbol,
        name: symbol.replace(/USDT$/, ""),
        color: LINE_COLORS[i % LINE_COLORS.length],
        values: candles.map((c) => c.close / base - 1),
        format: (v: number) => fmtPct(v),
      };
    });
    return { times: dataset.candles.map((c) => c.time), series };
  }, [dataset]);

  const summary = dataset && (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-panel px-4 py-3 text-xs">
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-semibold">资产组合</span>
        <span className="rounded bg-panel-2 px-1.5 py-0.5 text-muted">现货</span>
      </div>
      <SummaryStat
        label="区间 (UTC)"
        value={`${fmtDateTime(dataset.candles[0].time)} ~ ${fmtDateTime(dataset.candles[dataset.candles.length - 1].time)}`}
      />
      <SummaryStat label="周期" value={`${dataset.interval} · ${dataset.candles.length.toLocaleString()} 根`} />
      {dataset.symbols.map((symbol, i) => {
        const candles = dataset.assetCandles[i];
        const change = candles[candles.length - 1].close / candles[0].open - 1;
        return (
          <SummaryStat
            key={symbol}
            label={`${symbol.replace(/USDT$/, "")} 涨跌`}
            value={fmtPct(change)}
            className={pnlClass(change)}
          />
        );
      })}
    </div>
  );

  return (
    <SimulatorLayout
      sidebar={
        <>
          <MarketDataSection data={view} markets={["spot"]} showSymbol={false} datePresets={DATE_PRESETS} />
          <Section
            title="组合配置"
            extra={
              <span className={`num text-[11px] ${totalWeight > 100 ? "text-down" : "text-muted"}`}>
                USDT {Math.max(100 - totalWeight, 0).toFixed(1)}%
              </span>
            }
          >
            <div className="grid grid-cols-[minmax(0,1fr)_96px_24px] items-center gap-2 text-xs text-muted">
              <span>交易对</span>
              <span>目标权重</span>
              <span />
            </div>
            {form.assets.map((asset, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_96px_24px] items-center gap-2">
                <input
                  className={`${inputClass} num uppercase`}
                  list="rebalance-symbols"
                  value={asset.symbol}
                  placeholder="BTCUSDT"
                  onChange={(e) => updateAsset(i, { symbol: e.target.value.toUpperCase().trim() })}
                />
                <NumberInput value={asset.weight} onChange={(weight) => updateAsset(i, { weight })} suffix="%" min={0} />
                <button
                  type="button"
                  title="移除"
                  disabled={form.assets.length <= 1}
                  onClick={() => patchForm({ assets: form.assets.filter((_, j) => j !== i) })}
                  className="h-8 rounded text-muted hover:text-down disabled:opacity-30"
                >
                  ×
                </button>
              </div>
            ))}
            <datalist id="rebalance-symbols">
              {data.symbols.map((s) => (
                <option key={s.symbol} value={s.symbol} />
              ))}
            </datalist>
            <div className="flex items-center justify-between">
              <SmallButton
                onClick={() =>
                  form.assets.length < MAX_ASSETS && patchForm({ assets: [...form.assets, { symbol: "", weight: "10" }] })
                }
              >
                + 添加资产
              </SmallButton>
              <span className="text-[11px] text-muted">最多 {MAX_ASSETS} 个</span>
            </div>
            <p className="text-[11px] leading-snug text-muted">
              剩余权重以 USDT 现金持有。修改交易对后需点击「加载行情并回测」，只调整权重会立即重新回测。
            </p>

            <Field label="定期再平衡周期">
              <Segmented<DcaPeriod>
                size="sm"
                value={form.period}
                onChange={(period) => patchForm({ period })}
                options={(Object.keys(DCA_PERIOD_LABEL) as DcaPeriod[]).map((p) => ({ value: p, label: DCA_PERIOD_LABEL[p] }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="阈值再平衡偏离" hint="权重偏离目标的绝对值">
                <NumberInput value={form.threshold} onChange={(threshold) => patchForm({ threshold })} suffix="%" min={0} />
              </Field>
              <Field label="投入资金">
                <NumberInput
                  value={form.investment}
                  onChange={(investment) => patchForm({ investment })}
                  suffix="USDT"
                  min={0}
                />
              </Field>
            </div>
          </Section>
          <CostSections
            form={costForm}
            onChange={patchCost}
            market="spot"
            note="建仓与再平衡均为市价单，按 Taker 计费；再平衡先卖出超配资产，再买入低配资产。"
          />
          <ValidationMessage message={validationError} />
        </>
      }
    >
      <ResultsPanel
        data={view}
        results={results}
        columns={COLUMNS}
        message={validationError}
        defaultSelectedId="rebalance-periodic"
        summary={summary}
        showPosition={false}
        renderPriceChart={(sync) => (
          <Card title="各资产涨跌幅" extra={<span className="text-xs text-muted">相对回测起点，与收益曲线时间轴联动</span>}>
            {priceLines ? (
              <IndicatorChart times={priceLines.times} series={priceLines.series} sync={sync} height={360} />
            ) : (
              <div className="flex h-[360px] items-center justify-center text-sm text-muted">
                {data.loading ? "加载中…" : "暂无数据"}
              </div>
            )}
          </Card>
        )}
      />
    </SimulatorLayout>
  );
}

function SummaryStat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted">{label}</span>
      <span className={`num text-fg ${className}`}>{value}</span>
    </div>
  );
}

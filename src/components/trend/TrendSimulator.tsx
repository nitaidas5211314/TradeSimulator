"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { KlineOverlay } from "@/components/charts/KlineChart";
import { CostSections } from "@/components/simulator/CostSections";
import { DEFAULT_COST_FORM, parseNum, toCostParams, type CostForm } from "@/components/simulator/costForm";
import { MarketDataSection, type DatePresetOption } from "@/components/simulator/MarketDataSection";
import { createMarketForm } from "@/components/simulator/marketForm";
import { ParamScanCard } from "@/components/simulator/ParamScanCard";
import { ResultsPanel } from "@/components/simulator/ResultsPanel";
import { SimulatorLayout, ValidationMessage } from "@/components/simulator/SimulatorLayout";
import { statCell, type StatColumn } from "@/components/simulator/StatsTable";
import { useMarketData, type LoadedDataset } from "@/components/simulator/useMarketData";
import { useSimulation } from "@/components/simulator/useSimulation";
import { Field, NumberInput, Section, Segmented } from "@/components/ui/controls";
import type { StrategyResult } from "@/lib/backtest/common";
import { donchian } from "@/lib/backtest/indicators";
import {
  MAX_PERIOD,
  TREND_META,
  TREND_SCAN_AXES,
  movingAverages,
  runTrendScanCell,
  runTrendSimulation,
  validateTrendParams,
  type MaType,
  type TrendParams,
  type TrendSample,
  type TrendStrategyId,
} from "@/lib/backtest/trend";
import { fmtPct } from "@/lib/format";
import { KLINE_INTERVALS } from "@/lib/market/types";

interface TrendForm {
  investment: string;
  allowShort: boolean;
  maType: MaType;
  fastPeriod: string;
  slowPeriod: string;
  entryPeriod: string;
  exitPeriod: string;
  atrPeriod: string;
  atrStop: string;
}

const DEFAULT_FORM: TrendForm = {
  investment: "10000",
  allowShort: false,
  maType: "ema",
  fastPeriod: "20",
  slowPeriod: "50",
  entryPeriod: "20",
  exitPeriod: "10",
  atrPeriod: "14",
  atrStop: "2",
};

const DATE_PRESETS: DatePresetOption[] = [
  { days: 90, label: "90天" },
  { days: 180, label: "半年" },
  { days: 365, label: "1年" },
  { days: 730, label: "2年" },
  { days: 1095, label: "3年" },
];

const NO_OVERLAYS: KlineOverlay[] = [];

const isTrend = (r: StrategyResult) => r.id in TREND_META;

const fmtHours = (hours: number) => (hours < 48 ? `${hours.toFixed(1)} 小时` : `${(hours / 24).toFixed(1)} 天`);

const TREND_COLUMNS: StatColumn[] = [
  {
    key: "realizedPnl",
    label: "已实现盈亏",
    title: "已平仓交易的盈亏合计，未扣手续费",
    cell: (r) => (isTrend(r) ? statCell.pnl(r.realizedPnl) : statCell.dash),
  },
  { key: "roundTrips", label: "交易次数", title: "完整的开仓到平仓次数", cell: (r) => statCell.count(r.metrics.roundTrips) },
  {
    key: "winRate",
    label: "胜率",
    cell: (r) => (typeof r.metrics.winRate === "number" ? { text: fmtPct(r.metrics.winRate, false, 1) } : statCell.dash),
  },
  {
    key: "profitFactor",
    label: "盈亏比",
    title: "盈利交易总额 / 亏损交易总额",
    cell: (r) => (typeof r.metrics.profitFactor === "number" ? { text: r.metrics.profitFactor.toFixed(2) } : statCell.dash),
  },
  {
    key: "avgHoldHours",
    label: "平均持仓",
    cell: (r) => (typeof r.metrics.avgHoldHours === "number" ? { text: fmtHours(r.metrics.avgHoldHours) } : statCell.dash),
  },
  { key: "stops", label: "止损次数", cell: (r) => statCell.count(r.metrics.stops) },
  {
    key: "exposure",
    label: "在场时间",
    cell: (r) => (typeof r.metrics.exposure === "number" ? { text: fmtPct(r.metrics.exposure, false, 1) } : statCell.dash),
  },
];

const SAMPLE_OPTIONS: { value: TrendSample; label: string }[] = [
  { value: "in", label: "样本内 70%" },
  { value: "out", label: "样本外 30%" },
  { value: "all", label: "全部" },
];

function runTrend(dataset: LoadedDataset, params: TrendParams) {
  if (params.market !== dataset.market) return null;
  return runTrendSimulation(dataset.candles, dataset.funding, KLINE_INTERVALS[dataset.interval], params);
}

export default function TrendSimulator() {
  const [form, setForm] = useState<TrendForm>(DEFAULT_FORM);
  const [costForm, setCostForm] = useState<CostForm>(DEFAULT_COST_FORM);
  const [scanStrategy, setScanStrategy] = useState<TrendStrategyId>("ma-cross");
  const [sample, setSample] = useState<TrendSample>("in");
  const patchForm = useCallback((patch: Partial<TrendForm>) => setForm((f) => ({ ...f, ...patch })), []);
  const patchCost = useCallback((patch: Partial<CostForm>) => setCostForm((f) => ({ ...f, ...patch })), []);

  const data = useMarketData({ initialForm: () => createMarketForm({ days: 365, interval: "4h" }) });
  const { dataset, requestInfo } = data;

  const params: TrendParams | null = dataset
    ? {
        ...toCostParams(costForm, dataset.market),
        market: dataset.market,
        investment: parseNum(form.investment),
        allowShort: form.allowShort,
        maType: form.maType,
        fastPeriod: parseNum(form.fastPeriod),
        slowPeriod: parseNum(form.slowPeriod),
        entryPeriod: parseNum(form.entryPeriod),
        exitPeriod: parseNum(form.exitPeriod),
        atrPeriod: parseNum(form.atrPeriod),
        atrStop: parseNum(form.atrStop),
      }
    : null;
  const validationError = params ? validateTrendParams(params) : null;
  const results = useSimulation(dataset, validationError ? null : params, runTrend);

  // K线叠加线：均线交叉显示快慢线，通道突破显示入场通道
  const valid = params !== null && validationError === null;
  const { maType } = form;
  const fastPeriod = parseNum(form.fastPeriod);
  const slowPeriod = parseNum(form.slowPeriod);
  const entryPeriod = parseNum(form.entryPeriod);
  const lines = useMemo(() => {
    if (!dataset || !valid) return null;
    const { fast, slow } = movingAverages(dataset.candles, maType, fastPeriod, slowPeriod);
    const channel = donchian(dataset.candles, entryPeriod);
    return {
      ma: [
        { id: "fast", color: "#f0b90b", values: fast },
        { id: "slow", color: "#a855f7", values: slow },
      ],
      channel: [
        { id: "upper", color: "rgba(14,203,129,0.7)", values: channel.upper },
        { id: "lower", color: "rgba(246,70,93,0.7)", values: channel.lower },
      ],
    };
  }, [dataset, valid, maType, fastPeriod, slowPeriod, entryPeriod]);

  const overlaysFor = useCallback(
    (id: string | null) => (id === "ma-cross" ? lines?.ma : id === "donchian" ? lines?.channel : undefined) ?? NO_OVERLAYS,
    [lines],
  );

  const axes = TREND_SCAN_AXES[scanStrategy];
  const scanCard =
    dataset && params && !validationError ? (
      <ParamScanCard
        title={`参数扫描 · ${TREND_META[scanStrategy].name}`}
        description="样本内为前 70% 的K线，样本外为后 30%，指标在所选样本内重新计算。建议先在「样本内」挑选参数，再切到「样本外」检验同一组参数；若样本外明显变差，说明参数可能过拟合。点击格子套用参数。"
        rows={{ ...axes.rows, format: String }}
        cols={{ ...axes.cols, format: String }}
        // 扫描会覆盖对应的两个周期，这几项变化不影响扫描结果
        runKey={`${dataset.formKey}|${scanStrategy}|${sample}|${JSON.stringify({
          ...params,
          fastPeriod: 0,
          slowPeriod: 0,
          entryPeriod: 0,
          exitPeriod: 0,
        })}`}
        run={(row, col) =>
          runTrendScanCell(
            dataset.candles,
            dataset.funding,
            KLINE_INTERVALS[dataset.interval],
            params,
            scanStrategy,
            sample,
            row,
            col,
          )
        }
        onApply={(row, col) =>
          patchForm(
            scanStrategy === "ma-cross"
              ? { fastPeriod: String(row), slowPeriod: String(col) }
              : { entryPeriod: String(row), exitPeriod: String(col) },
          )
        }
        controls={
          <>
            <Segmented<TrendStrategyId>
              size="sm"
              value={scanStrategy}
              onChange={setScanStrategy}
              options={[
                { value: "ma-cross", label: "均线交叉" },
                { value: "donchian", label: "通道突破" },
              ]}
            />
            <Segmented<TrendSample> size="sm" value={sample} onChange={setSample} options={SAMPLE_OPTIONS} />
          </>
        }
      />
    ) : null;

  return (
    <SimulatorLayout
      sidebar={
        <>
          <MarketDataSection data={data} datePresets={DATE_PRESETS} />
          <Section title="策略参数">
            <Field label="投入资金">
              <NumberInput
                value={form.investment}
                onChange={(investment) => patchForm({ investment })}
                suffix="USDT"
                min={0}
              />
            </Field>
            {data.form.market === "futures" && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.allowShort}
                  onChange={(e) => patchForm({ allowShort: e.target.checked })}
                  className="accent-[#f0b90b]"
                />
                允许做空（信号反转时反手）
              </label>
            )}
            <p className="text-[11px] leading-snug text-muted">
              周期均以K线根数计，当前使用 {requestInfo.interval ?? "—"} K线；趋势策略建议使用 4h 或 1d。
            </p>

            <SubTitle>均线交叉</SubTitle>
            <Segmented<MaType>
              size="sm"
              value={form.maType}
              onChange={(v) => patchForm({ maType: v })}
              options={[
                { value: "ema", label: "EMA 指数均线" },
                { value: "sma", label: "SMA 简单均线" },
              ]}
            />
            <div className="grid grid-cols-2 gap-2">
              <Field label="快线周期">
                <PeriodInput value={form.fastPeriod} onChange={(fastPeriod) => patchForm({ fastPeriod })} />
              </Field>
              <Field label="慢线周期">
                <PeriodInput value={form.slowPeriod} onChange={(slowPeriod) => patchForm({ slowPeriod })} />
              </Field>
            </div>

            <SubTitle>通道突破（海龟）</SubTitle>
            <div className="grid grid-cols-2 gap-2">
              <Field label="入场通道 N" hint="突破前 N 根最高价">
                <PeriodInput value={form.entryPeriod} onChange={(entryPeriod) => patchForm({ entryPeriod })} />
              </Field>
              <Field label="离场通道 M" hint="跌破前 M 根最低价">
                <PeriodInput value={form.exitPeriod} onChange={(exitPeriod) => patchForm({ exitPeriod })} />
              </Field>
            </div>

            <SubTitle>ATR 止损（两个策略共用）</SubTitle>
            <div className="grid grid-cols-2 gap-2">
              <Field label="ATR 周期">
                <PeriodInput value={form.atrPeriod} onChange={(atrPeriod) => patchForm({ atrPeriod })} />
              </Field>
              <Field label="止损倍数" hint="0 为不止损">
                <NumberInput value={form.atrStop} onChange={(atrStop) => patchForm({ atrStop })} suffix="× ATR" min={0} />
              </Field>
            </div>
          </Section>
          <CostSections
            form={costForm}
            onChange={patchCost}
            market={data.form.market}
            note="信号在K线收盘确认，下一根开盘以市价成交；ATR 止损按止损价市价成交（开盘跳空时按开盘价）。均按 Taker 计费。"
          />
          <ValidationMessage message={validationError} />
        </>
      }
    >
      <ResultsPanel
        data={data}
        results={results}
        columns={TREND_COLUMNS}
        message={validationError}
        defaultSelectedId="ma-cross"
        overlaysFor={overlaysFor}
        extraCards={scanCard}
      />
    </SimulatorLayout>
  );
}

function SubTitle({ children }: { children: ReactNode }) {
  return <h4 className="pt-1 text-xs font-medium text-fg">{children}</h4>;
}

function PeriodInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <NumberInput value={value} onChange={onChange} suffix="根" step={1} min={2} max={MAX_PERIOD} />;
}

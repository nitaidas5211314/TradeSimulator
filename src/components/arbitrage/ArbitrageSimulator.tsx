"use client";

import { useCallback, useMemo, useState } from "react";
import { IndicatorChart, type IndicatorSeries } from "@/components/charts/IndicatorChart";
import { DEFAULT_COST_FORM, parseNum, type CostForm } from "@/components/simulator/costForm";
import { MarketDataSection } from "@/components/simulator/MarketDataSection";
import { createMarketForm } from "@/components/simulator/marketForm";
import { ResultsPanel } from "@/components/simulator/ResultsPanel";
import { SimulatorLayout, ValidationMessage } from "@/components/simulator/SimulatorLayout";
import { statCell, type StatColumn } from "@/components/simulator/StatsTable";
import { useMarketData, type LoadedDataset } from "@/components/simulator/useMarketData";
import { useSimulation } from "@/components/simulator/useSimulation";
import { Card, Field, NumberInput, Section } from "@/components/ui/controls";
import {
  ARBITRAGE_META,
  arbitrageIndicators,
  runArbitrageSimulation,
  validateArbitrageParams,
  type ArbitrageParams,
} from "@/lib/backtest/arbitrage";
import type { StrategyResult } from "@/lib/backtest/common";
import { fmtPct } from "@/lib/format";
import { loadArbitrageDataset, type ArbitrageDataset } from "@/lib/market/client";
import { KLINE_INTERVALS, type MarketType } from "@/lib/market/types";

interface ArbitrageForm {
  investment: string;
  leverage: string;
  rebalanceLeverage: string;
  /** 以下两项为百分比 */
  minFundingRate: string;
  maintenanceMarginRate: string;
}

const DEFAULT_FORM: ArbitrageForm = {
  investment: "10000",
  leverage: "2",
  rebalanceLeverage: "4",
  minFundingRate: "0",
  maintenanceMarginRate: "0.5",
};

const isArbitrage = (r: StrategyResult) => r.id in ARBITRAGE_META;

const COLUMNS: StatColumn[] = [
  {
    key: "fundingIncome",
    label: "资金费收入",
    cell: (r) => (isArbitrage(r) ? statCell.pnl(r.metrics.fundingIncome) : statCell.dash),
  },
  {
    key: "fundingApr",
    label: "资金费年化",
    title: "资金费收入 / 投入资金，按回测时长折算为年化",
    cell: (r) => (isArbitrage(r) ? statCell.pct(r.metrics.fundingApr) : statCell.dash),
  },
  {
    key: "priceBasisPnl",
    label: "价差盈亏",
    title: "总收益 − 资金费收入 + 手续费：两腿价格变动（基差变化）与强平带来的盈亏",
    cell: (r) => (isArbitrage(r) ? statCell.pnl(r.metrics.priceBasisPnl) : statCell.dash),
  },
  { key: "rebalances", label: "再平衡", cell: (r) => statCell.count(r.metrics.rebalances) },
  { key: "entries", label: "入场次数", cell: (r) => statCell.count(r.metrics.entries) },
  {
    key: "timeInMarket",
    label: "在场时间",
    cell: (r) =>
      isArbitrage(r) ? { text: fmtPct(r.metrics.timeInMarket ?? 0, false, 1) } : statCell.dash,
  },
];

function runArbitrage(dataset: LoadedDataset<ArbitrageDataset>, params: ArbitrageParams) {
  return runArbitrageSimulation(dataset, KLINE_INTERVALS[dataset.interval], params);
}

export default function ArbitrageSimulator() {
  const [form, setForm] = useState<ArbitrageForm>(DEFAULT_FORM);
  const [costForm, setCostForm] = useState<CostForm>(DEFAULT_COST_FORM);
  const patchForm = useCallback((patch: Partial<ArbitrageForm>) => setForm((f) => ({ ...f, ...patch })), []);
  const setTakerFee = (market: MarketType, taker: string) =>
    setCostForm((f) => ({ ...f, fees: { ...f.fees, [market]: { ...f.fees[market], taker } } }));

  const data = useMarketData<ArbitrageDataset>({
    initialForm: () => createMarketForm({ market: "futures" }),
    loader: loadArbitrageDataset,
  });
  const { dataset } = data;

  const params: ArbitrageParams = {
    investment: parseNum(form.investment),
    leverage: parseNum(form.leverage),
    rebalanceLeverage: parseNum(form.rebalanceLeverage),
    minFundingRate: parseNum(form.minFundingRate) / 100,
    spotFee: parseNum(costForm.fees.spot.taker) / 100,
    futuresFee: parseNum(costForm.fees.futures.taker) / 100,
    maintenanceMarginRate: parseNum(form.maintenanceMarginRate) / 100,
  };
  const validationError = validateArbitrageParams(params);
  const results = useSimulation(dataset, validationError ? null : params, runArbitrage);

  const times = useMemo(() => dataset?.candles.map((c) => c.time) ?? [], [dataset]);
  const indicatorSeries = useMemo<IndicatorSeries[] | null>(() => {
    if (!dataset) return null;
    const { basis, fundingApr } = arbitrageIndicators(dataset);
    return [
      {
        id: "basis",
        name: "基差（合约 / 现货 − 1）",
        color: "#f0b90b",
        values: basis,
        left: true,
        format: (v) => `${(v * 100).toFixed(3)}%`,
      },
      {
        id: "fundingApr",
        name: "资金费率（年化）",
        color: "#22c55e",
        values: fundingApr,
        format: (v) => `${(v * 100).toFixed(2)}%`,
      },
    ];
  }, [dataset]);

  const leverage = parseNum(form.leverage);

  return (
    <SimulatorLayout
      sidebar={
        <>
          <MarketDataSection data={data} markets={["futures"]} />
          <Section title="套利参数">
            <p className="text-[11px] leading-snug text-muted">
              同时加载该交易对的现货与 U本位永续K线：现货买入、合约等量做空，对冲价格涨跌，赚取资金费。
            </p>
            <Field label="投入资金">
              <NumberInput
                value={form.investment}
                onChange={(investment) => patchForm({ investment })}
                suffix="USDT"
                min={0}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="合约杠杆" hint="保证金 = 空单名义 / 杠杆">
                <NumberInput value={form.leverage} onChange={(v) => patchForm({ leverage: v })} suffix="x" min={1} />
              </Field>
              <Field label="再平衡触发杠杆" hint="合约端实际杠杆达到时">
                <NumberInput
                  value={form.rebalanceLeverage}
                  onChange={(rebalanceLeverage) => patchForm({ rebalanceLeverage })}
                  suffix="x"
                  min={1}
                />
              </Field>
              <Field label="择时离场费率" hint="上一期费率低于该值">
                <NumberInput
                  value={form.minFundingRate}
                  onChange={(minFundingRate) => patchForm({ minFundingRate })}
                  suffix="%"
                  step={0.001}
                />
              </Field>
              <Field label="维持保证金率">
                <NumberInput
                  value={form.maintenanceMarginRate}
                  onChange={(maintenanceMarginRate) => patchForm({ maintenanceMarginRate })}
                  suffix="%"
                  min={0}
                />
              </Field>
            </div>
            {leverage >= 1 && (
              <p className="text-[11px] leading-snug text-muted">
                资金分配：约 <span className="num text-fg">{fmtPct(leverage / (leverage + 1), false, 1)}</span> 买现货，
                <span className="num text-fg">{fmtPct(1 / (leverage + 1), false, 1)}</span>{" "}
                作为合约保证金。杠杆越高资金利用率越高，但价格上涨时越容易被强平。
              </p>
            )}
          </Section>
          <Section title="手续费">
            <div className="grid grid-cols-2 gap-2">
              <Field label="现货 Taker">
                <NumberInput
                  value={costForm.fees.spot.taker}
                  onChange={(v) => setTakerFee("spot", v)}
                  suffix="%"
                  min={0}
                />
              </Field>
              <Field label="合约 Taker">
                <NumberInput
                  value={costForm.fees.futures.taker}
                  onChange={(v) => setTakerFee("futures", v)}
                  suffix="%"
                  min={0}
                />
              </Field>
            </div>
            <p className="text-[11px] leading-snug text-muted">
              两腿均按市价单计费；入场、再平衡、离场时两边各收一次。
            </p>
          </Section>
          <ValidationMessage message={validationError} />
        </>
      }
    >
      <ResultsPanel
        data={data}
        results={results}
        columns={COLUMNS}
        message={validationError}
        defaultSelectedId="arb-rebalance"
        renderExtraCharts={(sync) =>
          indicatorSeries && (
            <Card
              title="基差与资金费率"
              extra={<span className="text-xs text-muted">左轴：基差，右轴：年化资金费率</span>}
            >
              <IndicatorChart times={times} series={indicatorSeries} sync={sync} />
            </Card>
          )
        }
      />
    </SimulatorLayout>
  );
}

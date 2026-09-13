"use client";

import { useCallback, useMemo, useState } from "react";
import { CostSections } from "@/components/simulator/CostSections";
import { DEFAULT_COST_FORM, parseNum, toCostParams, type CostForm } from "@/components/simulator/costForm";
import { summarizeDataset } from "@/components/simulator/DatasetSummary";
import { MarketDataSection } from "@/components/simulator/MarketDataSection";
import { createMarketForm } from "@/components/simulator/marketForm";
import { ResultsPanel } from "@/components/simulator/ResultsPanel";
import { SimulatorLayout, ValidationMessage } from "@/components/simulator/SimulatorLayout";
import { statCell, type StatColumn } from "@/components/simulator/StatsTable";
import { useMarketData, type LoadedDataset } from "@/components/simulator/useMarketData";
import { useSimulation } from "@/components/simulator/useSimulation";
import type { StrategyResult } from "@/lib/backtest/common";
import {
  GRID_META,
  buildGridLevels,
  gridProfitRange,
  runGridSimulation,
  validateGridParams,
  type GridParams,
} from "@/lib/backtest/grid";
import { roundPrice } from "@/lib/format";
import { KLINE_INTERVALS } from "@/lib/market/types";
import { DEFAULT_GRID_FORM, GridParamsSection, type GridForm } from "./GridParamsSection";

const isGrid = (r: StrategyResult) => r.id in GRID_META;

const GRID_COLUMNS: StatColumn[] = [
  {
    key: "gridProfit",
    label: "网格利润",
    title: "已配对（平仓）格子的价差收益，未扣手续费",
    cell: (r) => (isGrid(r) ? statCell.pnl(r.realizedPnl) : statCell.dash),
  },
  { key: "closeCount", label: "配对次数", cell: (r) => (isGrid(r) ? statCell.count(r.closeCount) : statCell.dash) },
  {
    key: "unrealizedPnl",
    label: "持仓盈亏",
    title: "总收益 − 网格利润 + 手续费 + 资金费，即持仓方向带来的盈亏",
    cell: (r) => statCell.pnl(r.stats.unrealizedPnl),
  },
];

const percentRange = (price: number) => ({
  lower: String(roundPrice(price * 0.85)),
  upper: String(roundPrice(price * 1.15)),
});

function runGrid(dataset: LoadedDataset, params: GridParams) {
  if (params.market !== dataset.market) return null;
  return {
    results: runGridSimulation(dataset.candles, dataset.funding, KLINE_INTERVALS[dataset.interval], params),
    levels: buildGridLevels(params.lower, params.upper, params.gridCount, params.gridMode),
  };
}

export default function GridSimulator() {
  const [gridForm, setGridForm] = useState<GridForm>(DEFAULT_GRID_FORM);
  const [costForm, setCostForm] = useState<CostForm>(DEFAULT_COST_FORM);
  const patchGrid = useCallback((patch: Partial<GridForm>) => setGridForm((f) => ({ ...f, ...patch })), []);
  const patchCost = useCallback((patch: Partial<CostForm>) => setCostForm((f) => ({ ...f, ...patch })), []);

  const data = useMarketData({
    initialForm: () => createMarketForm(),
    // 首次加载、换币种或当前区间不包含开盘价时，自动设置网格区间
    onLoaded: (dataset, previous) => {
      const assetChanged = !previous || previous.symbol !== dataset.symbol || previous.market !== dataset.market;
      const p0 = dataset.candles[0].open;
      setGridForm((f) => {
        const lower = Number(f.lower);
        const upper = Number(f.upper);
        const contains = lower > 0 && upper > lower && p0 > lower && p0 < upper;
        return contains && !assetChanged ? f : { ...f, ...percentRange(p0) };
      });
    },
  });
  const { dataset } = data;

  // 市场取已加载数据的市场，保证费率与数据一致
  const params: GridParams | null = dataset
    ? {
        ...toCostParams(costForm, dataset.market),
        market: dataset.market,
        investment: parseNum(gridForm.investment),
        lower: parseNum(gridForm.lower),
        upper: parseNum(gridForm.upper),
        gridCount: parseNum(gridForm.gridCount),
        gridMode: gridForm.gridMode,
      }
    : null;
  const validationError = params ? validateGridParams(params) : null;
  const simulation = useSimulation(dataset, validationError ? null : params, runGrid);

  const gridInfo =
    params && !validationError
      ? (() => {
          const range = gridProfitRange(
            buildGridLevels(params.lower, params.upper, params.gridCount, params.gridMode),
            params.makerFee,
          );
          return { profitMin: range.min, profitMax: range.max };
        })()
      : null;

  const summary = useMemo(() => (dataset ? summarizeDataset(dataset) : null), [dataset]);

  const onRangePreset = (kind: "percent" | "extremes") => {
    if (!summary) return;
    patchGrid(
      kind === "percent"
        ? percentRange(summary.first.open)
        : { lower: String(roundPrice(summary.low)), upper: String(roundPrice(summary.high)) },
    );
  };

  return (
    <SimulatorLayout
      sidebar={
        <>
          <MarketDataSection data={data} />
          <GridParamsSection
            form={gridForm}
            onChange={patchGrid}
            gridInfo={gridInfo}
            startPrice={summary?.first.open ?? null}
            onRangePreset={onRangePreset}
          />
          <CostSections
            form={costForm}
            onChange={patchCost}
            market={data.form.market}
            note="网格挂单成交按 Maker 计费；初始建仓与持有策略按 Taker 计费。现货与合约费率分别保存。"
          />
          <ValidationMessage message={validationError} />
        </>
      }
    >
      <ResultsPanel
        data={data}
        results={simulation?.results ?? null}
        levels={simulation?.levels}
        columns={GRID_COLUMNS}
        message={validationError}
        defaultSelectedId={dataset?.market === "futures" ? "long-grid" : "spot-grid"}
      />
    </SimulatorLayout>
  );
}

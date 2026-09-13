"use client";

import { useCallback, useState } from "react";
import { CostSections } from "@/components/simulator/CostSections";
import { DEFAULT_COST_FORM, parseNum, toCostParams, type CostForm } from "@/components/simulator/costForm";
import { MarketDataSection } from "@/components/simulator/MarketDataSection";
import { createMarketForm } from "@/components/simulator/marketForm";
import { ResultsPanel } from "@/components/simulator/ResultsPanel";
import { SimulatorLayout, ValidationMessage } from "@/components/simulator/SimulatorLayout";
import { statCell, type StatColumn } from "@/components/simulator/StatsTable";
import { useMarketData, type LoadedDataset } from "@/components/simulator/useMarketData";
import { useSimulation } from "@/components/simulator/useSimulation";
import { Field, NumberInput, Section } from "@/components/ui/controls";
import type { StrategyResult } from "@/lib/backtest/common";
import {
  MARTINGALE_META,
  MAX_SAFETY_ORDERS,
  martingaleLadder,
  runMartingaleSimulation,
  validateMartingaleParams,
  type MartingaleParams,
} from "@/lib/backtest/martingale";
import { fmtPct, fmtUsd } from "@/lib/format";
import { KLINE_INTERVALS, type MarketType } from "@/lib/market/types";

interface MartingaleForm {
  investment: string;
  /** 以下三项为百分比 */
  priceStep: string;
  takeProfit: string;
  stopLoss: string;
  stepScale: string;
  volumeScale: string;
  maxSafetyOrders: string;
}

const DEFAULT_FORM: MartingaleForm = {
  investment: "10000",
  priceStep: "2",
  takeProfit: "1.5",
  stopLoss: "0",
  stepScale: "1.2",
  volumeScale: "1.5",
  maxSafetyOrders: "6",
};

const isBot = (r: StrategyResult) => r.id in MARTINGALE_META;

const MARTINGALE_COLUMNS: StatColumn[] = [
  {
    key: "realizedPnl",
    label: "已实现利润",
    title: "止盈、止损平仓的盈亏合计，未扣手续费",
    cell: (r) => (isBot(r) ? statCell.pnl(r.realizedPnl) : statCell.dash),
  },
  { key: "cycles", label: "止盈轮数", cell: (r) => statCell.count(r.metrics.cycles) },
  {
    key: "maxSafetyUsed",
    label: "最多加仓",
    title: "单轮内最多成交的加仓次数",
    cell: (r) => statCell.count(r.metrics.maxSafetyUsed),
  },
  { key: "stops", label: "止损次数", cell: (r) => statCell.count(r.metrics.stops) },
  {
    key: "unrealizedPnl",
    label: "持仓盈亏",
    title: "期末未平仓部分的浮动盈亏",
    cell: (r) => statCell.pnl(r.stats.unrealizedPnl),
  },
];

function toParams(form: MartingaleForm, costForm: CostForm, market: MarketType): MartingaleParams {
  return {
    ...toCostParams(costForm, market),
    market,
    investment: parseNum(form.investment),
    priceStep: parseNum(form.priceStep) / 100,
    stepScale: parseNum(form.stepScale),
    volumeScale: parseNum(form.volumeScale),
    maxSafetyOrders: parseNum(form.maxSafetyOrders),
    takeProfit: parseNum(form.takeProfit) / 100,
    stopLoss: parseNum(form.stopLoss) / 100,
  };
}

function runMartingale(dataset: LoadedDataset, params: MartingaleParams) {
  if (params.market !== dataset.market) return null;
  return runMartingaleSimulation(dataset.candles, dataset.funding, KLINE_INTERVALS[dataset.interval], params);
}

export default function MartingaleSimulator() {
  const [form, setForm] = useState<MartingaleForm>(DEFAULT_FORM);
  const [costForm, setCostForm] = useState<CostForm>(DEFAULT_COST_FORM);
  const patchForm = useCallback((patch: Partial<MartingaleForm>) => setForm((f) => ({ ...f, ...patch })), []);
  const patchCost = useCallback((patch: Partial<CostForm>) => setCostForm((f) => ({ ...f, ...patch })), []);

  const data = useMarketData({ initialForm: () => createMarketForm() });
  const { dataset } = data;

  const params = dataset ? toParams(form, costForm, dataset.market) : null;
  const validationError = params ? validateMartingaleParams(params) : null;
  const results = useSimulation(dataset, validationError ? null : params, runMartingale);

  // 阶梯预览跟随左侧当前选择的市场
  const previewParams = toParams(form, costForm, data.form.market);
  const previewValid = validateMartingaleParams(previewParams) === null;

  return (
    <SimulatorLayout
      sidebar={
        <>
          <MarketDataSection data={data} />
          <Section title="马丁格尔参数">
            <Field label="投入资金">
              <NumberInput
                value={form.investment}
                onChange={(investment) => patchForm({ investment })}
                suffix="USDT"
                min={0}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="加仓间隔" hint="首次加仓的价格偏离">
                <NumberInput value={form.priceStep} onChange={(priceStep) => patchForm({ priceStep })} suffix="%" min={0} />
              </Field>
              <Field label="间隔倍数" hint="之后每次间隔的放大倍数">
                <NumberInput value={form.stepScale} onChange={(stepScale) => patchForm({ stepScale })} suffix="倍" min={0.5} />
              </Field>
              <Field label="加仓倍数" hint="每次加仓金额的放大倍数">
                <NumberInput
                  value={form.volumeScale}
                  onChange={(volumeScale) => patchForm({ volumeScale })}
                  suffix="倍"
                  min={0.5}
                />
              </Field>
              <Field label="最大加仓次数">
                <NumberInput
                  value={form.maxSafetyOrders}
                  onChange={(maxSafetyOrders) => patchForm({ maxSafetyOrders })}
                  step={1}
                  min={0}
                  max={MAX_SAFETY_ORDERS}
                />
              </Field>
              <Field label="止盈比例" hint="相对持仓均价">
                <NumberInput value={form.takeProfit} onChange={(takeProfit) => patchForm({ takeProfit })} suffix="%" min={0} />
              </Field>
              <Field label="止损比例" hint="相对均价，0 为不止损">
                <NumberInput value={form.stopLoss} onChange={(stopLoss) => patchForm({ stopLoss })} suffix="%" min={0} />
              </Field>
            </div>
            {previewValid && <LadderPreview params={previewParams} />}
          </Section>
          <CostSections
            form={costForm}
            onChange={patchCost}
            market={data.form.market}
            note="首单与止损为市价单按 Taker 计费；加仓与止盈为挂单按 Maker 计费。现货与合约费率分别保存。"
          />
          <ValidationMessage message={validationError} />
        </>
      }
    >
      <ResultsPanel
        data={data}
        results={results}
        columns={MARTINGALE_COLUMNS}
        message={validationError}
        defaultSelectedId={dataset?.market === "futures" ? "martingale-long" : "martingale-spot"}
      />
    </SimulatorLayout>
  );
}

function LadderPreview({ params }: { params: MartingaleParams }) {
  const spot = params.market === "spot";
  const capital = spot
    ? params.investment / (1 + Math.max(params.makerFee, params.takerFee))
    : params.investment * params.leverage;
  const ladder = martingaleLadder(capital, params);

  return (
    <div className="space-y-2">
      <div className="max-h-48 overflow-y-auto rounded border border-line">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-panel-2 text-muted">
            <tr>
              <th className="px-2 py-1 text-left font-normal">订单</th>
              <th className="px-2 py-1 text-right font-normal">{spot ? "相对首单跌幅" : "相对首单偏离"}</th>
              <th className="px-2 py-1 text-right font-normal">名义金额</th>
            </tr>
          </thead>
          <tbody>
            {ladder.rows.map((row, i) => (
              <tr key={i} className="border-t border-line/60">
                <td className="px-2 py-1">{i === 0 ? "首单" : `加仓 ${i}`}</td>
                <td className="num px-2 py-1 text-right">
                  {i === 0 ? "—" : `${spot ? "-" : "±"}${(row.deviation * 100).toFixed(2)}%`}
                </td>
                <td className="num px-2 py-1 text-right">{fmtUsd(row.quote)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-snug text-muted">
        做多全部加仓后，均价比首单低 <span className="num text-fg">{fmtPct(ladder.fullAvgDeviation, false)}</span>
        ，需从最后一次加仓价反弹 <span className="num text-fg">{fmtPct(ladder.reboundToTakeProfit, false)}</span> 才能止盈。
        {!spot && ` 合约名义金额 = 投入 × ${params.leverage}x，加满仓时更容易被强平。`}
      </p>
    </div>
  );
}

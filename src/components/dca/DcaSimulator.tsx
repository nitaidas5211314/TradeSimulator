"use client";

import { useCallback, useState } from "react";
import { CostSections } from "@/components/simulator/CostSections";
import { DEFAULT_COST_FORM, parseNum, toCostParams, type CostForm } from "@/components/simulator/costForm";
import { MarketDataSection, type DatePresetOption } from "@/components/simulator/MarketDataSection";
import { createMarketForm } from "@/components/simulator/marketForm";
import { ResultsPanel } from "@/components/simulator/ResultsPanel";
import { SimulatorLayout, ValidationMessage } from "@/components/simulator/SimulatorLayout";
import { statCell, type StatColumn } from "@/components/simulator/StatsTable";
import { useMarketData, type LoadedDataset } from "@/components/simulator/useMarketData";
import { useSimulation } from "@/components/simulator/useSimulation";
import { Field, NumberInput, Section, Segmented } from "@/components/ui/controls";
import {
  DCA_PERIOD_LABEL,
  MAX_DCA_MULTIPLE,
  dcaSchedule,
  runDcaSimulation,
  validateDcaParams,
  type DcaParams,
  type DcaPeriod,
} from "@/lib/backtest/dca";
import { fmtUsd } from "@/lib/format";
import { KLINE_INTERVALS } from "@/lib/market/types";

interface DcaForm {
  amount: string;
  period: DcaPeriod;
  maxMultiple: string;
}

const DEFAULT_DCA_FORM: DcaForm = { amount: "100", period: "week", maxMultiple: "3" };

const DATE_PRESETS: DatePresetOption[] = [
  { days: 30, label: "30天" },
  { days: 90, label: "90天" },
  { days: 180, label: "半年" },
  { days: 365, label: "1年" },
  { days: 1095, label: "3年" },
];

const DCA_COLUMNS: StatColumn[] = [
  {
    key: "invested",
    label: "投入本金",
    title: "已花费在买入上的资金（含手续费）",
    cell: (r) => statCell.usd(r.metrics.invested),
  },
  { key: "cash", label: "剩余现金", cell: (r) => statCell.usd(r.metrics.cash) },
  { key: "buyCount", label: "买入次数", cell: (r) => statCell.count(r.metrics.buyCount) },
  { key: "avgCost", label: "持仓均价", cell: (r) => statCell.price(r.metrics.avgCost) },
  {
    key: "holdingReturn",
    label: "本金收益率",
    title: "（持仓市值 − 投入本金）/ 投入本金，不含未投入的现金",
    cell: (r) => statCell.pct(r.metrics.holdingReturn),
  },
];

function runDca(dataset: LoadedDataset, params: DcaParams) {
  return runDcaSimulation(dataset.candles, KLINE_INTERVALS[dataset.interval], params);
}

export default function DcaSimulator() {
  const [dcaForm, setDcaForm] = useState<DcaForm>(DEFAULT_DCA_FORM);
  const [costForm, setCostForm] = useState<CostForm>(DEFAULT_COST_FORM);
  const patchDca = useCallback((patch: Partial<DcaForm>) => setDcaForm((f) => ({ ...f, ...patch })), []);
  const patchCost = useCallback((patch: Partial<CostForm>) => setCostForm((f) => ({ ...f, ...patch })), []);

  const data = useMarketData({ initialForm: () => createMarketForm({ market: "spot", days: 365 }) });
  const { dataset, requestInfo } = data;

  const costs = toCostParams(costForm, "spot");
  const params: DcaParams | null = dataset
    ? {
        amount: parseNum(dcaForm.amount),
        period: dcaForm.period,
        maxMultiple: parseNum(dcaForm.maxMultiple),
        makerFee: costs.makerFee,
        takerFee: costs.takerFee,
      }
    : null;
  const validationError = params ? validateDcaParams(params) : null;
  const results = useSimulation(dataset, validationError ? null : params, runDca);

  // 按所选日期预估期数，实际以加载到的数据为准
  const amount = parseNum(dcaForm.amount);
  const periods = requestInfo.request
    ? dcaSchedule(requestInfo.request.start, requestInfo.request.end, dcaForm.period).length
    : 0;

  return (
    <SimulatorLayout
      sidebar={
        <>
          <MarketDataSection data={data} markets={["spot"]} datePresets={DATE_PRESETS} />
          <Section title="定投参数">
            <Field label="定投周期">
              <Segmented<DcaPeriod>
                value={dcaForm.period}
                onChange={(period) => patchDca({ period })}
                options={(Object.keys(DCA_PERIOD_LABEL) as DcaPeriod[]).map((p) => ({
                  value: p,
                  label: DCA_PERIOD_LABEL[p],
                }))}
              />
            </Field>
            <Field label="每期金额">
              <NumberInput value={dcaForm.amount} onChange={(v) => patchDca({ amount: v })} suffix="USDT" min={0} />
            </Field>
            <Field label="价值平均单期上限" hint="价值平均策略单期最多买入「每期金额 × 倍数」">
              <NumberInput
                value={dcaForm.maxMultiple}
                onChange={(maxMultiple) => patchDca({ maxMultiple })}
                suffix="倍"
                min={1}
                max={MAX_DCA_MULTIPLE}
              />
            </Field>
            {periods > 0 && amount > 0 && (
              <p className="text-[11px] leading-snug text-muted">
                所选区间共 <span className="num text-fg">{periods}</span> 期，计划总投入约{" "}
                <span className="num text-fg">{fmtUsd(periods * amount)}</span> USDT（另加手续费）；
                一次性买入使用相同的资金，未投入的资金按现金计入权益。
              </p>
            )}
          </Section>
          <CostSections
            form={costForm}
            onChange={patchCost}
            market="spot"
            note="定投与一次性买入均为市价单，按 Taker 计费。"
          />
          <ValidationMessage message={validationError} />
        </>
      }
    >
      <ResultsPanel
        data={data}
        results={results}
        columns={DCA_COLUMNS}
        message={validationError}
        defaultSelectedId="dca-fixed"
      />
    </SimulatorLayout>
  );
}

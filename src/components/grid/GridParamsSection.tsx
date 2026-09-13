"use client";

import { Field, NumberInput, Section, Segmented, SmallButton } from "@/components/ui/controls";
import { MAX_GRID_COUNT, type GridMode } from "@/lib/backtest/grid";
import { fmtPct, fmtPrice } from "@/lib/format";

export interface GridForm {
  lower: string;
  upper: string;
  gridCount: string;
  gridMode: GridMode;
  investment: string;
}

export const DEFAULT_GRID_FORM: GridForm = {
  lower: "",
  upper: "",
  gridCount: "20",
  gridMode: "arithmetic",
  investment: "10000",
};

export interface GridInfo {
  profitMin: number;
  profitMax: number;
}

export function GridParamsSection({
  form,
  onChange,
  gridInfo,
  startPrice,
  onRangePreset,
}: {
  form: GridForm;
  onChange: (patch: Partial<GridForm>) => void;
  gridInfo: GridInfo | null;
  startPrice: number | null;
  onRangePreset: (kind: "percent" | "extremes") => void;
}) {
  return (
    <Section
      title="网格参数"
      extra={startPrice !== null && <span className="num text-[11px] text-muted">开盘价 {fmtPrice(startPrice)}</span>}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="价格下限">
          <NumberInput value={form.lower} onChange={(lower) => onChange({ lower })} min={0} />
        </Field>
        <Field label="价格上限">
          <NumberInput value={form.upper} onChange={(upper) => onChange({ upper })} min={0} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-1">
        <SmallButton onClick={() => onRangePreset("percent")} title="以回测开始时的开盘价上下 15% 作为区间">
          开盘价 ±15%
        </SmallButton>
        <SmallButton onClick={() => onRangePreset("extremes")} title="注意：使用了未来数据，仅供参考">
          区间最低 / 最高价
        </SmallButton>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="网格数量">
          <NumberInput
            value={form.gridCount}
            onChange={(gridCount) => onChange({ gridCount })}
            step={1}
            min={2}
            max={MAX_GRID_COUNT}
          />
        </Field>
        <Field label="网格类型">
          <Segmented<GridMode>
            value={form.gridMode}
            onChange={(gridMode) => onChange({ gridMode })}
            options={[
              { value: "arithmetic", label: "等差" },
              { value: "geometric", label: "等比" },
            ]}
          />
        </Field>
      </div>
      {gridInfo && (
        <p className={`text-[11px] ${gridInfo.profitMin <= 0 ? "text-down" : "text-muted"}`}>
          每格利润率（扣除双边挂单费）：
          <span className="num">
            {gridInfo.profitMin.toFixed(6) === gridInfo.profitMax.toFixed(6)
              ? fmtPct(gridInfo.profitMin, false)
              : `${fmtPct(gridInfo.profitMin, false)} ~ ${fmtPct(gridInfo.profitMax, false)}`}
          </span>
          {gridInfo.profitMin <= 0 && "，部分格子利润不足以覆盖手续费"}
        </p>
      )}

      <Field label="投入资金">
        <NumberInput value={form.investment} onChange={(investment) => onChange({ investment })} suffix="USDT" min={0} />
      </Field>
    </Section>
  );
}

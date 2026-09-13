"use client";

import { Field, NumberInput, Section, SmallButton } from "@/components/ui/controls";
import type { MarketType } from "@/lib/market/types";
import type { CostForm, FeeInputs } from "./costForm";

const LEVERAGE_PRESETS = [1, 2, 3, 5, 10, 20];

/** 合约参数（仅合约）与手续费设置 */
export function CostSections({
  form,
  onChange,
  market,
  note,
}: {
  form: CostForm;
  onChange: (patch: Partial<CostForm>) => void;
  market: MarketType;
  note: string;
}) {
  const fees = form.fees[market];
  const setFee = (patch: Partial<FeeInputs>) => onChange({ fees: { ...form.fees, [market]: { ...fees, ...patch } } });

  return (
    <>
      {market === "futures" && (
        <Section title="合约参数">
          <Field label="杠杆倍数">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={125}
                value={Number(form.leverage) || 1}
                onChange={(e) => onChange({ leverage: e.target.value })}
                className="flex-1 accent-[#f0b90b]"
              />
              <div className="w-20">
                <NumberInput
                  value={form.leverage}
                  onChange={(leverage) => onChange({ leverage })}
                  suffix="x"
                  min={1}
                  max={125}
                />
              </div>
            </div>
          </Field>
          <div className="flex flex-wrap gap-1">
            {LEVERAGE_PRESETS.map((l) => (
              <SmallButton key={l} onClick={() => onChange({ leverage: String(l) })}>
                {l}x
              </SmallButton>
            ))}
          </div>
          <Field label="维持保证金率" hint="低于该比例触发强平，Binance 按仓位档位 0.4% ~ 数% 不等">
            <NumberInput
              value={form.maintenanceMarginRate}
              onChange={(maintenanceMarginRate) => onChange({ maintenanceMarginRate })}
              suffix="%"
              min={0}
            />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.includeFunding}
              onChange={(e) => onChange({ includeFunding: e.target.checked })}
              className="accent-[#f0b90b]"
            />
            计入历史资金费率
          </label>
        </Section>
      )}

      <Section title="手续费">
        <div className="grid grid-cols-2 gap-2">
          <Field label="挂单 Maker">
            <NumberInput value={fees.maker} onChange={(maker) => setFee({ maker })} suffix="%" min={0} />
          </Field>
          <Field label="吃单 Taker">
            <NumberInput value={fees.taker} onChange={(taker) => setFee({ taker })} suffix="%" min={0} />
          </Field>
        </div>
        <p className="text-[11px] leading-snug text-muted">{note}</p>
      </Section>
    </>
  );
}

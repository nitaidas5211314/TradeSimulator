"use client";

import { MAX_GRID_COUNT, type GridMode } from "@/lib/backtest/grid";
import { fmtDate, fmtPct, fmtPrice } from "@/lib/format";
import { KLINE_INTERVALS, type KlineInterval, type MarketType, type SymbolInfo } from "@/lib/market/types";
import { Field, NumberInput, Section, Segmented, SmallButton, inputClass } from "@/components/ui/controls";
import { datePreset, type FeeInputs, type FormState, type IntervalChoice, type RequestInfo } from "./form";

export interface GridInfo {
  profitMin: number;
  profitMax: number;
}

const INTERVAL_OPTIONS: { value: IntervalChoice; label: string }[] = [
  { value: "auto", label: "自动" },
  ...(Object.keys(KLINE_INTERVALS) as KlineInterval[]).map((i) => ({ value: i, label: i })),
];

const DATE_PRESETS = [
  { days: 7, label: "7天" },
  { days: 30, label: "30天" },
  { days: 90, label: "90天" },
  { days: 180, label: "半年" },
  { days: 365, label: "1年" },
];

const LEVERAGE_PRESETS = [1, 2, 3, 5, 10, 20];

export function ParamsPanel({
  form,
  onChange,
  symbols,
  requestInfo,
  loading,
  stale,
  onLoad,
  gridInfo,
  validationError,
  startPrice,
  onRangePreset,
}: {
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
  symbols: SymbolInfo[];
  requestInfo: RequestInfo;
  loading: boolean;
  stale: boolean;
  onLoad: () => void;
  gridInfo: GridInfo | null;
  validationError: string | null;
  startPrice: number | null;
  onRangePreset: (kind: "percent" | "extremes") => void;
}) {
  const fees = form.fees[form.market];
  const setFee = (patch: Partial<FeeInputs>) =>
    onChange({ fees: { ...form.fees, [form.market]: { ...fees, ...patch } } });
  const futures = form.market === "futures";
  const onboard = symbols.find((s) => s.symbol === form.symbol.toUpperCase())?.onboardDate;

  return (
    <div className="rounded-lg border border-line bg-panel">
      <Section title="行情数据">
        <Segmented<MarketType>
          value={form.market}
          onChange={(market) => onChange({ market })}
          options={[
            { value: "spot", label: "现货" },
            { value: "futures", label: "U本位永续合约" },
          ]}
        />

        <Field
          label="交易对"
          hint={
            onboard && futures && requestInfo.request && onboard > requestInfo.request.start
              ? `该合约 ${fmtDate(onboard)} 上线，早于此日期无数据`
              : undefined
          }
        >
          <input
            className={`${inputClass} num uppercase`}
            list={`symbols-${form.market}`}
            value={form.symbol}
            placeholder="BTCUSDT"
            onChange={(e) => onChange({ symbol: e.target.value.toUpperCase().trim() })}
          />
          <datalist id={`symbols-${form.market}`}>
            {symbols.map((s) => (
              <option key={s.symbol} value={s.symbol} />
            ))}
          </datalist>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="开始日期">
            <input
              type="date"
              className={`${inputClass} num`}
              value={form.startDate}
              max={form.endDate}
              onChange={(e) => onChange({ startDate: e.target.value })}
            />
          </Field>
          <Field label="结束日期">
            <input
              type="date"
              className={`${inputClass} num`}
              value={form.endDate}
              min={form.startDate}
              onChange={(e) => onChange({ endDate: e.target.value })}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-1">
          {DATE_PRESETS.map((p) => (
            <SmallButton key={p.days} onClick={() => onChange(datePreset(p.days))}>
              近{p.label}
            </SmallButton>
          ))}
        </div>

        <Field
          label="K线周期（撮合精度）"
          hint={
            requestInfo.interval
              ? `使用 ${requestInfo.interval}，约 ${requestInfo.estimate.toLocaleString()} 根K线。周期越小，K线内撮合越精确`
              : undefined
          }
        >
          <select
            className={inputClass}
            value={form.interval}
            onChange={(e) => onChange({ interval: e.target.value as IntervalChoice })}
          >
            {INTERVAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        {requestInfo.error && <p className="text-xs text-down">{requestInfo.error}</p>}

        <button
          type="button"
          onClick={onLoad}
          disabled={loading || !requestInfo.request}
          className={`h-9 w-full rounded text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            stale ? "bg-accent text-black hover:bg-accent/90" : "border border-line text-fg hover:border-accent"
          }`}
        >
          {loading ? "加载中…" : stale ? "加载行情并回测" : "重新加载行情"}
        </button>
      </Section>

      <Section
        title="网格参数"
        extra={
          startPrice !== null && (
            <span className="num text-[11px] text-muted">开盘价 {fmtPrice(startPrice)}</span>
          )
        }
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

      {futures && (
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
                <NumberInput value={form.leverage} onChange={(leverage) => onChange({ leverage })} suffix="x" min={1} max={125} />
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
        <p className="text-[11px] leading-snug text-muted">
          网格挂单成交按 Maker 计费；初始建仓与持有策略按 Taker 计费。现货与合约费率分别保存。
        </p>
        {validationError && <p className="text-xs text-down">{validationError}</p>}
      </Section>
    </div>
  );
}

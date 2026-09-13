"use client";

import { Field, Section, Segmented, SmallButton, inputClass } from "@/components/ui/controls";
import { fmtDate } from "@/lib/format";
import { KLINE_INTERVALS, type KlineInterval, type MarketType } from "@/lib/market/types";
import { datePreset, type IntervalChoice } from "./marketForm";
import type { MarketDataState } from "./useMarketData";

const INTERVAL_OPTIONS: { value: IntervalChoice; label: string }[] = [
  { value: "auto", label: "自动" },
  ...(Object.keys(KLINE_INTERVALS) as KlineInterval[]).map((i) => ({ value: i, label: i })),
];

export interface DatePresetOption {
  days: number;
  label: string;
}

const DEFAULT_DATE_PRESETS: DatePresetOption[] = [
  { days: 7, label: "7天" },
  { days: 30, label: "30天" },
  { days: 90, label: "90天" },
  { days: 180, label: "半年" },
  { days: 365, label: "1年" },
];

const MARKET_LABEL: Record<MarketType, string> = { spot: "现货", futures: "U本位永续合约" };

export function MarketDataSection({
  data,
  markets = ["spot", "futures"],
  datePresets = DEFAULT_DATE_PRESETS,
}: {
  data: MarketDataState;
  markets?: MarketType[];
  datePresets?: DatePresetOption[];
}) {
  const { form, patch, symbols, requestInfo, loading, stale, load } = data;
  const onboard = symbols.find((s) => s.symbol === form.symbol.toUpperCase())?.onboardDate;

  return (
    <Section title="行情数据">
      {markets.length > 1 && (
        <Segmented<MarketType>
          value={form.market}
          onChange={(market) => patch({ market })}
          options={markets.map((m) => ({ value: m, label: MARKET_LABEL[m] }))}
        />
      )}

      <Field
        label="交易对"
        hint={
          onboard && form.market === "futures" && requestInfo.request && onboard > requestInfo.request.start
            ? `该合约 ${fmtDate(onboard)} 上线，早于此日期无数据`
            : undefined
        }
      >
        <input
          className={`${inputClass} num uppercase`}
          list={`symbols-${form.market}`}
          value={form.symbol}
          placeholder="BTCUSDT"
          onChange={(e) => patch({ symbol: e.target.value.toUpperCase().trim() })}
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
            onChange={(e) => patch({ startDate: e.target.value })}
          />
        </Field>
        <Field label="结束日期">
          <input
            type="date"
            className={`${inputClass} num`}
            value={form.endDate}
            min={form.startDate}
            onChange={(e) => patch({ endDate: e.target.value })}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-1">
        {datePresets.map((p) => (
          <SmallButton key={p.days} onClick={() => patch(datePreset(p.days))}>
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
          onChange={(e) => patch({ interval: e.target.value as IntervalChoice })}
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
        onClick={load}
        disabled={loading || !requestInfo.request}
        className={`h-9 w-full rounded text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          stale ? "bg-accent text-black hover:bg-accent/90" : "border border-line text-fg hover:border-accent"
        }`}
      >
        {loading ? "加载中…" : stale ? "加载行情并回测" : "重新加载行情"}
      </button>
    </Section>
  );
}

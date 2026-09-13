"use client";

import { useMemo } from "react";
import { fmtDateTime, fmtPct, fmtPrice, pnlClass } from "@/lib/format";
import { KLINE_INTERVALS } from "@/lib/market/types";
import type { LoadedDataset } from "./useMarketData";

export function summarizeDataset(dataset: LoadedDataset) {
  const { candles, funding } = dataset;
  let high = -Infinity;
  let low = Infinity;
  for (const c of candles) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  const first = candles[0];
  const last = candles[candles.length - 1];
  return {
    first,
    last,
    high,
    low,
    change: last.close / first.open - 1,
    fundingSum: funding.reduce((sum, f) => sum + f.rate, 0),
  };
}

export function DatasetSummary({ dataset, loading }: { dataset: LoadedDataset | null; loading: boolean }) {
  const summary = useMemo(() => (dataset ? summarizeDataset(dataset) : null), [dataset]);

  if (!dataset || !summary) {
    return (
      <div className="rounded-lg border border-line bg-panel px-4 py-3 text-xs text-muted">
        {loading ? "正在从 Binance 加载行情…" : "请在左侧选择参数并加载行情"}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-panel px-4 py-3 text-xs">
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-semibold">{dataset.symbol}</span>
        <span className="rounded bg-panel-2 px-1.5 py-0.5 text-muted">
          {dataset.market === "spot" ? "现货" : "U本位永续"}
        </span>
      </div>
      <Stat label="区间 (UTC)" value={`${fmtDateTime(summary.first.time)} ~ ${fmtDateTime(summary.last.time)}`} />
      <Stat label="周期" value={`${dataset.interval} · ${dataset.candles.length.toLocaleString()} 根`} />
      <Stat label="开盘 → 收盘" value={`${fmtPrice(summary.first.open)} → ${fmtPrice(summary.last.close)}`} />
      <Stat label="区间涨跌" value={fmtPct(summary.change)} className={pnlClass(summary.change)} />
      <Stat label="最高 / 最低" value={`${fmtPrice(summary.high)} / ${fmtPrice(summary.low)}`} />
      {dataset.market === "futures" && (
        <Stat
          label="累计资金费率"
          value={`${fmtPct(summary.fundingSum, true, 3)}（${dataset.funding.length} 次）`}
          className={pnlClass(-summary.fundingSum)}
        />
      )}
      {summary.first.time > dataset.start + KLINE_INTERVALS[dataset.interval] && (
        <span className="text-accent">数据起始晚于所选日期（交易对上线较晚）</span>
      )}
      {dataset.source === "archive" && (
        <span className="basis-full text-[11px] leading-relaxed text-accent">
          合约行情接口在服务器所在地区不可用，已改用 Binance 官方历史归档 data.binance.vision，数据最新至昨日（UTC）
          {dataset.fundingEstimatedFrom !== null &&
            `；${fmtDateTime(dataset.fundingEstimatedFrom)} 起的资金费率尚未归档，按溢价指数公式估算`}
          。
        </span>
      )}
    </div>
  );
}

function Stat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted">{label}</span>
      <span className={`num text-fg ${className}`}>{value}</span>
    </div>
  );
}

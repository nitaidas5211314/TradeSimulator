import type { StrategyResult } from "@/lib/backtest/common";
import { fmtDateTime, fmtPct, fmtPrice, fmtQty, fmtUsd, pnlClass } from "@/lib/format";

export interface StatCell {
  text: string;
  className?: string;
}

/** 策略专属列，插在通用指标之间 */
export interface StatColumn {
  key: string;
  label: string;
  title?: string;
  cell: (r: StrategyResult) => StatCell;
}

type Value = number | null | undefined;
const missing = (v: Value): v is null | undefined => v === null || v === undefined;

/** 常用单元格格式；值缺失时显示 — */
export const statCell = {
  dash: { text: "—", className: "text-muted" } as StatCell,
  pnl: (v: Value): StatCell => (missing(v) ? statCell.dash : { text: fmtUsd(v, true), className: pnlClass(v) }),
  usd: (v: Value): StatCell => (missing(v) ? statCell.dash : { text: fmtUsd(v) }),
  count: (v: Value): StatCell => (missing(v) ? statCell.dash : { text: v.toLocaleString() }),
  price: (v: Value): StatCell => (missing(v) ? statCell.dash : { text: fmtPrice(v) }),
  pct: (v: Value): StatCell => (missing(v) ? statCell.dash : { text: fmtPct(v), className: pnlClass(v) }),
  time: (v: Value): StatCell => (missing(v) ? statCell.dash : { text: fmtDateTime(v), className: "text-accent" }),
};

export function StatsTable({
  results,
  futures,
  columns,
}: {
  results: StrategyResult[];
  futures: boolean;
  columns: StatColumn[];
}) {
  const th = "whitespace-nowrap px-3 py-2 text-right font-normal";
  const td = "num whitespace-nowrap px-3 py-2.5 text-right";

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted">
          <tr className="border-b border-line">
            <th className={`${th} text-left`}>策略</th>
            <th className={th}>期末权益</th>
            <th className={th}>总收益</th>
            <th className={th}>收益率</th>
            <th className={th}>年化</th>
            <th className={th}>最大回撤</th>
            {columns.map((c) => (
              <th key={c.key} className={th} title={c.title}>
                {c.label}
              </th>
            ))}
            <th className={th}>手续费</th>
            {futures && (
              <th className={th} title="正数为支付，负数为收取">
                资金费
              </th>
            )}
            <th className={th}>期末持仓</th>
            <th className={`${th} text-left`}>状态</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const s = r.stats;
            return (
              <tr key={r.id} className="border-b border-line/60 last:border-b-0 hover:bg-panel-2/60">
                <td className="whitespace-nowrap px-3 py-2.5" title={r.description}>
                  <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />
                  {r.name}
                </td>
                <td className={td}>{fmtUsd(s.finalEquity)}</td>
                <td className={`${td} ${pnlClass(s.pnl)}`}>{fmtUsd(s.pnl, true)}</td>
                <td className={`${td} ${pnlClass(s.returnPct)}`}>{fmtPct(s.returnPct)}</td>
                <td className={`${td} ${pnlClass(s.annualizedReturn ?? 0)}`}>{fmtPct(s.annualizedReturn)}</td>
                <td className={`${td} text-down`}>{fmtPct(-s.maxDrawdown)}</td>
                {columns.map((c) => {
                  const cell = c.cell(r);
                  return (
                    <td key={c.key} className={`${td} ${cell.className ?? ""}`}>
                      {cell.text}
                    </td>
                  );
                })}
                <td className={`${td} text-down`}>{fmtUsd(-s.feesPaid)}</td>
                {futures && (
                  <td className={`${td} ${pnlClass(-s.fundingPaid)}`} title={`共结算 ${s.fundingCount} 次`}>
                    {fmtUsd(s.fundingPaid, true)}
                  </td>
                )}
                <td
                  className={`${td} ${s.finalPosition > 0 ? "text-up" : s.finalPosition < 0 ? "text-down" : "text-muted"}`}
                >
                  {s.finalPosition === 0
                    ? "0"
                    : `${s.finalPosition > 0 ? "多 " : "空 "}${fmtQty(Math.abs(s.finalPosition))}`}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  {r.liquidation ? (
                    <span className="rounded bg-down/15 px-1.5 py-0.5 text-down">
                      爆仓 {fmtDateTime(r.liquidation.time)} @ {fmtPrice(r.liquidation.price)}
                    </span>
                  ) : (
                    <span className="text-muted">正常</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

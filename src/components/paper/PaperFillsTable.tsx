"use client";

import { fmtDate, fmtPrice, fmtQty, fmtTime, fmtUsd, pnlClass } from "@/lib/format";
import type { PaperFill, PaperStrategy } from "@/lib/paper/account";
import { PAPER_ACTION_LABEL } from "./paperExport";

const MAX_ROWS = 100;

interface Row extends PaperFill {
  strategy: PaperStrategy;
}

/** 全部策略的成交记录，按时间倒序 */
export function PaperFillsTable({ strategies }: { strategies: PaperStrategy[] }) {
  const rows: Row[] = strategies
    .flatMap((strategy) => strategy.fills.map((fill) => ({ ...fill, strategy })))
    .sort((a, b) => b.time - a.time);

  if (rows.length === 0) {
    return <div className="px-4 py-10 text-center text-sm text-muted">还没有成交，在策略卡片里建仓后会显示在这里</div>;
  }

  const th = "whitespace-nowrap px-3 py-2 text-right font-normal";
  const td = "num whitespace-nowrap px-3 py-2 text-right";

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className={`${th} text-left`}>时间 (UTC)</th>
              <th className={`${th} text-left`}>策略</th>
              <th className={`${th} text-left`}>类型</th>
              <th className={`${th} text-left`}>方向</th>
              <th className={th}>成交价</th>
              <th className={th}>数量</th>
              <th className={th}>成交额</th>
              <th className={th}>手续费</th>
              <th className={th}>已实现盈亏</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, MAX_ROWS).map((r, i) => (
              <tr key={`${r.strategy.id}-${r.time}-${i}`} className="border-b border-line/50 last:border-b-0 hover:bg-panel-2/60">
                <td className="num whitespace-nowrap px-3 py-2 text-muted">
                  {fmtDate(r.time)} {fmtTime(r.time)}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.strategy.color }} />
                    <span className="max-w-[10rem] truncate">{r.strategy.name}</span>
                  </span>
                </td>
                <td className={`whitespace-nowrap px-3 py-2 ${r.action === "liquidation" ? "text-down" : ""}`}>
                  {PAPER_ACTION_LABEL[r.action]}
                  {r.maker && <span className="ml-1 text-muted">挂单</span>}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 ${r.side === "buy" ? "text-up" : "text-down"}`}>
                  {r.side === "buy" ? "买入" : "卖出"}
                </td>
                <td className={td}>{fmtPrice(r.price)}</td>
                <td className={td}>{fmtQty(r.qty)}</td>
                <td className={td}>{fmtUsd(r.qty * r.price)}</td>
                <td className={`${td} text-muted`}>{fmtUsd(r.fee)}</td>
                <td className={`${td} ${r.profit === null ? "text-muted" : pnlClass(r.profit)}`}>
                  {r.profit === null ? "—" : fmtUsd(r.profit, true)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line px-4 py-2 text-xs text-muted">
        共 {rows.length.toLocaleString()} 笔成交{rows.length > MAX_ROWS && `，显示最近 ${MAX_ROWS} 笔`}
      </div>
    </div>
  );
}

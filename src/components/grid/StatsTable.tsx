import type { StrategyResult } from "@/lib/backtest/grid";
import { fmtDateTime, fmtPct, fmtPrice, fmtQty, fmtUsd, pnlClass } from "@/lib/format";

const isGrid = (r: StrategyResult) => r.id.endsWith("grid");

export function StatsTable({ results, futures }: { results: StrategyResult[]; futures: boolean }) {
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
            <th className={th} title="已配对（平仓）格子的价差收益，未扣手续费">
              网格利润
            </th>
            <th className={th}>配对次数</th>
            <th className={th} title="总收益 − 网格利润 + 手续费 + 资金费，即持仓方向带来的盈亏">
              持仓盈亏
            </th>
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
                <td className={`${td} ${isGrid(r) ? pnlClass(s.gridProfit) : "text-muted"}`}>
                  {isGrid(r) ? fmtUsd(s.gridProfit, true) : "—"}
                </td>
                <td className={td}>{isGrid(r) ? s.matchedCount.toLocaleString() : "—"}</td>
                <td className={`${td} ${pnlClass(s.positionPnl)}`}>{fmtUsd(s.positionPnl, true)}</td>
                <td className={`${td} text-down`}>{fmtUsd(-s.feesPaid)}</td>
                {futures && (
                  <td className={`${td} ${pnlClass(-s.fundingPaid)}`} title={`共结算 ${s.fundingCount} 次`}>
                    {fmtUsd(s.fundingPaid, true)}
                  </td>
                )}
                <td className={`${td} ${s.finalPosition > 0 ? "text-up" : s.finalPosition < 0 ? "text-down" : "text-muted"}`}>
                  {s.finalPosition === 0 ? "0" : `${s.finalPosition > 0 ? "多 " : "空 "}${fmtQty(Math.abs(s.finalPosition))}`}
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

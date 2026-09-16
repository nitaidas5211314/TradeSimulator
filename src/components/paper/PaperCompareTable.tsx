"use client";

import { fmtDuration, fmtPct, fmtPrice, fmtQty, fmtUsd, pnlClass } from "@/lib/format";
import type { MarketType } from "@/lib/market/types";
import type { PaperStats, PaperStrategy } from "@/lib/paper/account";

/** 各策略实时指标横向对比 */
export function PaperCompareTable({
  strategies,
  stats,
  market,
}: {
  strategies: PaperStrategy[];
  stats: Map<string, PaperStats>;
  market: MarketType;
}) {
  const futures = market === "futures";
  const th = "whitespace-nowrap px-3 py-2 text-right font-normal";
  const td = "num whitespace-nowrap px-3 py-2.5 text-right";

  const totals = strategies.reduce(
    (acc, s) => {
      const st = stats.get(s.id);
      acc.investment += s.investment;
      acc.equity += st ? st.equity : s.investment;
      acc.unrealized += st ? st.unrealizedPnl : 0;
      acc.realized += s.realizedPnl;
      acc.fees += s.feesPaid;
      acc.funding += s.fundingPaid;
      return acc;
    },
    { investment: 0, equity: 0, unrealized: 0, realized: 0, fees: 0, funding: 0 },
  );
  const totalReturn = totals.investment > 0 ? totals.equity / totals.investment - 1 : 0;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted">
          <tr className="border-b border-line">
            <th className={`${th} text-left`}>策略</th>
            <th className={th}>持仓</th>
            <th className={th}>持仓均价</th>
            <th className={th}>名义价值</th>
            <th className={th}>未实现</th>
            <th className={th}>已实现</th>
            <th className={th}>手续费</th>
            {futures && <th className={th}>资金费</th>}
            <th className={th}>权益</th>
            <th className={th}>收益率</th>
            <th className={th}>最大回撤</th>
            <th className={th} title="已平仓次数中盈利的比例">
              胜率
            </th>
            <th className={th} title="总盈利 / 总亏损">
              盈亏比
            </th>
            <th className={th} title="首次建仓至今">
              持仓时长
            </th>
            <th className={th} title="首次建仓至今的币价涨跌">
              建仓后币价
            </th>
            <th className={th} title="建仓时按同样杠杆满仓买入并持有至今的收益率">
              满仓持有对比
            </th>
            {futures && <th className={th}>预估强平价</th>}
            <th className={th}>成交</th>
          </tr>
        </thead>
        <tbody>
          {strategies.map((s) => {
            const st = stats.get(s.id);
            return (
              <tr key={s.id} className="border-b border-line/50 last:border-b-0 hover:bg-panel-2/60">
                <td className="whitespace-nowrap px-3 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                    <span className="max-w-[10rem] truncate" title={s.note || s.name}>
                      {s.name}
                    </span>
                    <span className="shrink-0 text-muted">{futures ? `${s.leverage}x` : "现货"}</span>
                    {s.liquidatedAt !== null && <span className="shrink-0 text-down">已爆仓</span>}
                  </span>
                </td>
                <td className={`${td} ${s.position > 0 ? "text-up" : s.position < 0 ? "text-down" : "text-muted"}`}>
                  {s.position === 0 ? "无" : `${s.position > 0 ? "多" : "空"} ${fmtQty(Math.abs(s.position))}`}
                </td>
                <td className={td}>{s.position === 0 ? "—" : fmtPrice(s.avgEntry)}</td>
                <td className={td}>{st ? fmtUsd(Math.abs(st.positionValue)) : "—"}</td>
                <td className={`${td} ${pnlClass(st?.unrealizedPnl ?? 0)}`}>
                  {st ? fmtUsd(st.unrealizedPnl, true) : "—"}
                </td>
                <td className={`${td} ${pnlClass(s.realizedPnl)}`}>{fmtUsd(s.realizedPnl, true)}</td>
                <td className={`${td} text-muted`}>{fmtUsd(-s.feesPaid)}</td>
                {futures && (
                  <td className={`${td} ${pnlClass(-s.fundingPaid)}`}>
                    {s.fundingPaid === 0 ? "—" : fmtUsd(-s.fundingPaid, true)}
                  </td>
                )}
                <td className={td}>{st ? fmtUsd(st.equity) : "—"}</td>
                <td className={`${td} ${pnlClass(st?.returnPct ?? 0)}`}>{st ? fmtPct(st.returnPct) : "—"}</td>
                <td className={`${td} text-down`}>{fmtPct(-s.maxDrawdown)}</td>
                <td className={`${td} text-muted`}>
                  {st?.winRate == null ? "—" : `${fmtPct(st.winRate, false, 0)}（${st.closedCount}）`}
                </td>
                <td className={`${td} text-muted`}>{st?.profitFactor == null ? "—" : st.profitFactor.toFixed(2)}</td>
                <td className={`${td} text-muted`}>{st?.holdMs == null ? "—" : fmtDuration(st.holdMs)}</td>
                <td className={`${td} ${pnlClass(st?.priceChangeSinceOpen ?? 0)}`}>
                  {fmtPct(st?.priceChangeSinceOpen ?? null)}
                </td>
                <td className={`${td} ${pnlClass(st?.holdReturn ?? 0)}`}>{fmtPct(st?.holdReturn ?? null)}</td>
                {futures && (
                  <td className={`${td} ${st?.liquidationPrice ? "text-down" : "text-muted"}`}>
                    {st?.liquidationPrice ? fmtPrice(st.liquidationPrice) : "—"}
                  </td>
                )}
                <td className={`${td} text-muted`}>{s.fills.length}</td>
              </tr>
            );
          })}
        </tbody>
        {strategies.length > 1 && (
          <tfoot className="border-t border-line text-muted">
            <tr>
              <td className="whitespace-nowrap px-3 py-2.5">合计</td>
              <td className={td} colSpan={3} />
              <td className={`${td} ${pnlClass(totals.unrealized)}`}>{fmtUsd(totals.unrealized, true)}</td>
              <td className={`${td} ${pnlClass(totals.realized)}`}>{fmtUsd(totals.realized, true)}</td>
              <td className={td}>{fmtUsd(-totals.fees)}</td>
              {futures && <td className={`${td} ${pnlClass(-totals.funding)}`}>{fmtUsd(-totals.funding, true)}</td>}
              <td className={td}>{fmtUsd(totals.equity)}</td>
              <td className={`${td} ${pnlClass(totalReturn)}`}>{fmtPct(totalReturn)}</td>
              <td className={td} colSpan={futures ? 7 : 6} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

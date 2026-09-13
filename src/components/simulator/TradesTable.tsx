"use client";

import { useState } from "react";
import type { StrategyResult } from "@/lib/backtest/common";
import type { TradeAction } from "@/lib/backtest/engine";
import { fmtDateTime, fmtPrice, fmtQty, fmtUsd, pnlClass } from "@/lib/format";

const PAGE_SIZE = 50;

const ACTION_LABEL: Record<TradeAction, string> = {
  init: "初始建仓",
  open: "开仓",
  close: "平仓",
  dca: "定投买入",
  base: "首单",
  safety: "加仓",
  takeProfit: "止盈",
  stopLoss: "止损",
  liquidation: "强制平仓",
};

export function TradesTable({ result }: { result: StrategyResult }) {
  // 切换策略或结果变化时回到第一页
  const [pageState, setPageState] = useState({ trades: result.trades, page: 0 });
  const trades = result.trades;
  const page = pageState.trades === trades ? pageState.page : 0;
  const pageCount = Math.max(1, Math.ceil(trades.length / PAGE_SIZE));
  const rows = trades.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const goto = (p: number) => setPageState({ trades, page: Math.min(Math.max(p, 0), pageCount - 1) });

  const th = "whitespace-nowrap px-3 py-2 text-right font-normal";
  const td = "num whitespace-nowrap px-3 py-2 text-right";

  if (trades.length === 0) {
    return <div className="px-4 py-10 text-center text-sm text-muted">该策略在回测期间没有成交</div>;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className={`${th} text-left`}>时间 (UTC)</th>
              <th className={`${th} text-left`}>方向</th>
              <th className={`${th} text-left`}>类型</th>
              <th className={th}>成交价</th>
              <th className={th}>数量</th>
              <th className={th}>成交额</th>
              <th className={th}>手续费</th>
              <th className={th}>已实现盈亏</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={page * PAGE_SIZE + i} className="border-b border-line/50 last:border-b-0 hover:bg-panel-2/60">
                <td className="num whitespace-nowrap px-3 py-2 text-muted">{fmtDateTime(t.time)}</td>
                <td className={`whitespace-nowrap px-3 py-2 ${t.side === "buy" ? "text-up" : "text-down"}`}>
                  {t.side === "buy" ? "买入" : "卖出"}
                </td>
                <td
                  className={`whitespace-nowrap px-3 py-2 ${
                    t.action === "liquidation" || t.action === "stopLoss" ? "text-down" : ""
                  }`}
                >
                  {ACTION_LABEL[t.action]}
                </td>
                <td className={td}>{fmtPrice(t.price)}</td>
                <td className={td}>{fmtQty(t.qty)}</td>
                <td className={td}>{fmtUsd(t.qty * t.price)}</td>
                <td className={`${td} text-muted`}>{fmtUsd(t.fee)}</td>
                <td className={`${td} ${t.profit === null ? "text-muted" : pnlClass(t.profit)}`}>
                  {t.profit === null ? "—" : fmtUsd(t.profit, true)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
        <span>共 {trades.length.toLocaleString()} 笔成交</span>
        <div className="flex items-center gap-1">
          <PageButton onClick={() => goto(0)} disabled={page === 0}>
            首页
          </PageButton>
          <PageButton onClick={() => goto(page - 1)} disabled={page === 0}>
            上一页
          </PageButton>
          <span className="num px-2">
            {page + 1} / {pageCount}
          </span>
          <PageButton onClick={() => goto(page + 1)} disabled={page >= pageCount - 1}>
            下一页
          </PageButton>
          <PageButton onClick={() => goto(pageCount - 1)} disabled={page >= pageCount - 1}>
            末页
          </PageButton>
        </div>
      </div>
    </div>
  );
}

function PageButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-line px-2 py-0.5 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

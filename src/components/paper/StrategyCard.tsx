"use client";

import { useState } from "react";
import { Field, NumberInput, Segmented, SmallButton, inputClass } from "@/components/ui/controls";
import { fmtDuration, fmtPct, fmtPrice, fmtQty, fmtUsd, pnlClass } from "@/lib/format";
import type { MarketType } from "@/lib/market/types";
import {
  STRATEGY_COLORS,
  maxPaperQty,
  type PaperOrderType,
  type PaperSide,
  type PaperStats,
  type PaperStrategy,
} from "@/lib/paper/account";

type OrderKind = "market" | PaperOrderType;

const AMOUNT_PRESETS = [0.25, 0.5, 0.75, 1];
const REDUCE_PRESETS = [0.25, 0.5, 0.75];

export interface StrategyActions {
  /** 均返回错误信息，成功返回 null */
  trade: (side: PaperSide, qty: number) => string | null;
  placeOrder: (type: PaperOrderType, side: PaperSide, price: number, qty: number) => string | null;
  cancelOrder: (id: number) => void;
  reduce: (fraction: number) => string | null;
  edit: (patch: { name?: string; note?: string; color?: string }) => void;
  remove: () => void;
}

/** 单个策略：实时指标 + 建仓 / 减仓 / 平仓 / 挂单 */
export function StrategyCard({
  strategy,
  market,
  price,
  stats,
  actions,
}: {
  strategy: PaperStrategy;
  market: MarketType;
  price: number | null;
  stats: PaperStats | null;
  actions: StrategyActions;
}) {
  const [side, setSide] = useState<PaperSide>("buy");
  const [kind, setKind] = useState<OrderKind>("market");
  const [amount, setAmount] = useState("");
  const [orderPrice, setOrderPrice] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const futures = market === "futures";
  const liquidated = strategy.liquidatedAt !== null;
  const ticketPrice = kind === "market" ? price : Number(orderPrice) || null;
  const maxQty = ticketPrice ? maxPaperQty(strategy, market, side, ticketPrice) : 0;

  const run = (action: () => string | null) => setMessage(action());

  const submit = () =>
    run(() => {
      if (!price) return "等待实时价格";
      const usd = Number(amount);
      if (!(usd > 0)) return "请输入下单金额";
      if (kind === "market") {
        const error = actions.trade(side, usd / price);
        if (!error) setAmount("");
        return error;
      }
      const limit = Number(orderPrice);
      if (!(limit > 0)) return "请输入有效价格";
      const error = actions.placeOrder(kind, side, limit, usd / limit);
      if (!error) setAmount("");
      return error;
    });

  const opening = strategy.position === 0 || (side === "buy") === strategy.position > 0;
  const sideLabel = side === "buy" ? (futures ? "买入 / 做多" : "买入") : futures ? "卖出 / 做空" : "卖出";

  return (
    <section className={`rounded-lg border bg-panel ${liquidated ? "border-down/50" : "border-line"}`}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: strategy.color }} />
        <span className="truncate text-sm font-medium">{strategy.name}</span>
        <span className="shrink-0 rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-muted">
          {futures ? `${strategy.leverage}x 永续` : "现货"}
        </span>
        {liquidated && <span className="shrink-0 rounded bg-down/15 px-1.5 py-0.5 text-[11px] text-down">已爆仓</span>}
        <div className="ml-auto flex shrink-0 gap-1">
          <SmallButton onClick={() => setEditing((e) => !e)} title="修改名称、备注与颜色">
            {editing ? "完成" : "编辑"}
          </SmallButton>
          <SmallButton onClick={actions.remove} title="删除该策略及其记录">
            删除
          </SmallButton>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2 border-b border-line px-4 py-3">
          <Field label="策略名称">
            <input
              className={inputClass}
              value={strategy.name}
              onChange={(e) => actions.edit({ name: e.target.value })}
            />
          </Field>
          <Field label="策略思路">
            <input
              className={inputClass}
              value={strategy.note}
              placeholder="如：跌 3% 加仓一次"
              onChange={(e) => actions.edit({ note: e.target.value })}
            />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {STRATEGY_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => actions.edit({ color: c })}
                style={{ background: c }}
                className={`h-5 w-5 rounded-full transition-transform ${
                  strategy.color === c ? "ring-2 ring-fg ring-offset-2 ring-offset-panel" : "hover:scale-110"
                }`}
                aria-label={c}
              />
            ))}
          </div>
        </div>
      ) : (
        strategy.note && (
          <p className="border-b border-line px-4 py-2 text-[11px] leading-snug text-muted">{strategy.note}</p>
        )
      )}

      <div className="flex items-end justify-between gap-2 px-4 pt-3">
        <div>
          <div className="text-[11px] text-muted">实时收益率</div>
          <div className={`num text-2xl font-semibold ${pnlClass(stats?.returnPct ?? 0)}`}>
            {stats ? fmtPct(stats.returnPct) : "—"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-muted">权益 / 初始</div>
          <div className="num text-sm">
            {stats ? fmtUsd(stats.equity) : "—"} <span className="text-muted">/ {fmtUsd(strategy.investment)}</span>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 text-xs">
        <Metric
          label="持仓"
          value={
            strategy.position === 0
              ? "无"
              : `${strategy.position > 0 ? "多" : "空"} ${fmtQty(Math.abs(strategy.position))}`
          }
          className={strategy.position > 0 ? "text-up" : strategy.position < 0 ? "text-down" : "text-muted"}
        />
        <Metric label="持仓均价" value={strategy.position === 0 ? "—" : fmtPrice(strategy.avgEntry)} />
        <Metric
          label="未实现盈亏"
          value={stats ? fmtUsd(stats.unrealizedPnl, true) : "—"}
          className={pnlClass(stats?.unrealizedPnl ?? 0)}
        />
        <Metric
          label="已实现盈亏"
          value={fmtUsd(strategy.realizedPnl, true)}
          className={pnlClass(strategy.realizedPnl)}
        />
        <Metric label="名义价值" value={stats ? fmtUsd(Math.abs(stats.positionValue)) : "—"} />
        <Metric label={futures ? "可用保证金" : "可用 USDT"} value={stats ? fmtUsd(stats.available) : "—"} />
        <Metric label="持仓时长" value={stats?.holdMs == null ? "—" : fmtDuration(stats.holdMs)} />
        <Metric label="最大回撤" value={fmtPct(-strategy.maxDrawdown)} className="text-down" />
        <Metric
          label="手续费"
          value={
            futures && strategy.fundingPaid !== 0
              ? `${fmtUsd(-strategy.feesPaid)} · 资金费 ${fmtUsd(-strategy.fundingPaid, true)}`
              : fmtUsd(-strategy.feesPaid)
          }
          className="text-muted"
        />
        {futures ? (
          <Metric
            label="预估强平价"
            value={stats?.liquidationPrice ? fmtPrice(stats.liquidationPrice) : "—"}
            className={stats?.liquidationPrice ? "text-down" : ""}
          />
        ) : (
          <Metric
            label="建仓后币价"
            value={fmtPct(stats?.priceChangeSinceOpen ?? null)}
            className={pnlClass(stats?.priceChangeSinceOpen ?? 0)}
          />
        )}
      </dl>

      <div className="space-y-2.5 border-t border-line px-4 py-3">
        {futures && (
          <Segmented<PaperSide>
            size="sm"
            value={side}
            onChange={setSide}
            options={[
              { value: "buy", label: "买入 / 做多" },
              { value: "sell", label: "卖出 / 做空" },
            ]}
          />
        )}
        <Segmented<OrderKind>
          size="sm"
          value={kind}
          onChange={setKind}
          options={[
            { value: "market", label: "市价" },
            { value: "limit", label: "限价" },
            { value: "stop", label: "止损" },
          ]}
        />
        {kind !== "market" && (
          <Field
            label={kind === "limit" ? "限价" : "触发价"}
            hint={
              kind === "limit"
                ? side === "buy"
                  ? "价格跌到该价时买入"
                  : "价格涨到该价时卖出"
                : side === "buy"
                  ? "价格涨到该价时市价买入"
                  : "价格跌到该价时市价卖出"
            }
          >
            <div className="flex gap-1">
              <div className="flex-1">
                <NumberInput value={orderPrice} onChange={setOrderPrice} min={0} placeholder="0" />
              </div>
              <SmallButton onClick={() => price && setOrderPrice(String(price))}>现价</SmallButton>
            </div>
          </Field>
        )}
        <Field label={`${opening ? "建仓" : "反向"}金额（名义价值）`}>
          <NumberInput value={amount} onChange={setAmount} suffix="USDT" min={0} placeholder="0" />
        </Field>
        <div className="flex gap-1">
          {AMOUNT_PRESETS.map((pct) => (
            <SmallButton
              key={pct}
              onClick={() => ticketPrice && setAmount(String(Math.floor(maxQty * ticketPrice * pct * 100) / 100))}
            >
              {pct * 100}%
            </SmallButton>
          ))}
          <span className="ml-auto self-center text-[11px] text-muted">
            上限 <span className="num">{fmtUsd(maxQty * (ticketPrice ?? 0))}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={liquidated || !price}
          className={`h-9 w-full rounded text-sm font-medium disabled:opacity-40 ${
            side === "buy" ? "bg-up text-black hover:bg-up/90" : "bg-down text-white hover:bg-down/90"
          }`}
        >
          {kind === "market" ? "市价" : kind === "limit" ? "挂限价" : "挂止损"}
          {sideLabel}
          {kind === "market" && strategy.position !== 0 && (
            <span className="ml-1 text-xs opacity-80">{opening ? "（加仓）" : "（反向）"}</span>
          )}
        </button>

        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted">减仓</span>
          {REDUCE_PRESETS.map((pct) => (
            <SmallButton key={pct} onClick={() => run(() => actions.reduce(pct))}>
              {pct * 100}%
            </SmallButton>
          ))}
          <button
            type="button"
            onClick={() => run(() => actions.reduce(1))}
            disabled={strategy.position === 0}
            className="ml-auto rounded border border-line px-2.5 py-1 text-[11px] text-fg transition-colors hover:border-accent disabled:opacity-40"
          >
            全部平仓
          </button>
        </div>
        {message && <p className="text-[11px] text-down">{message}</p>}
        {strategy.notice && <p className="text-[11px] text-accent">{strategy.notice}</p>}
      </div>

      {strategy.orders.length > 0 && (
        <div className="border-t border-line px-4 py-2.5">
          <div className="mb-1.5 text-[11px] text-muted">当前挂单（{strategy.orders.length}）</div>
          <ul className="space-y-1">
            {strategy.orders.map((o) => (
              <li key={o.id} className="flex items-center gap-2 text-[11px]">
                <span className={o.side === "buy" ? "text-up" : "text-down"}>
                  {o.side === "buy" ? "买" : "卖"}
                  {o.type === "limit" ? "限价" : "止损"}
                </span>
                <span className="num">{fmtPrice(o.price)}</span>
                <span className="num text-muted">{fmtQty(o.qty)}</span>
                <span className="num text-muted">≈{fmtUsd(o.qty * o.price)}</span>
                <span className="ml-auto">
                  <SmallButton onClick={() => actions.cancelOrder(o.id)}>撤单</SmallButton>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{label}</dt>
      <dd className={`num truncate ${className}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

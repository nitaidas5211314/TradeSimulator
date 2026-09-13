"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { IndicatorChart, type IndicatorSeries } from "@/components/charts/IndicatorChart";
import { KlineChart, type PriceLine } from "@/components/charts/KlineChart";
import { CostSections } from "@/components/simulator/CostSections";
import { DEFAULT_COST_FORM, parseNum, toCostParams, type CostForm } from "@/components/simulator/costForm";
import { MarketDataSection } from "@/components/simulator/MarketDataSection";
import { createMarketForm } from "@/components/simulator/marketForm";
import { SimulatorLayout } from "@/components/simulator/SimulatorLayout";
import { buildTradeMarkers } from "@/components/simulator/tradeMarkers";
import { TradesTable } from "@/components/simulator/TradesTable";
import { useMarketData, type LoadedDataset } from "@/components/simulator/useMarketData";
import { Card, Field, NumberInput, Section, Segmented, SmallButton } from "@/components/ui/controls";
import {
  advanceReplay,
  cancelReplayOrder,
  closeReplayPosition,
  createReplay,
  maxOrderQty,
  placeMarketOrder,
  placePendingOrder,
  replayStats,
  validateReplayConfig,
  type ReplayConfig,
  type ReplaySide,
  type ReplayState,
} from "@/lib/backtest/replay";
import { fmtDateTime, fmtPct, fmtPrice, fmtQty, fmtUsd, pnlClass } from "@/lib/format";

type OrderKind = "market" | "limit" | "stop";

interface ReplaySettings {
  investment: string;
  warmup: string;
}

const DEFAULT_SETTINGS: ReplaySettings = { investment: "10000", warmup: "200" };
const SPEEDS = [1, 2, 5, 10, 30];
const AMOUNT_PRESETS = [0.25, 0.5, 0.75, 1];

export default function ReplaySimulator() {
  const [settings, setSettings] = useState<ReplaySettings>(DEFAULT_SETTINGS);
  const [costForm, setCostForm] = useState<CostForm>(DEFAULT_COST_FORM);
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [side, setSide] = useState<ReplaySide>("buy");
  const [kind, setKind] = useState<OrderKind>("market");
  const [orderPrice, setOrderPrice] = useState("");
  const [orderAmount, setOrderAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const patchSettings = useCallback((patch: Partial<ReplaySettings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const patchCost = useCallback((patch: Partial<CostForm>) => setCostForm((f) => ({ ...f, ...patch })), []);

  const start = (dataset: LoadedDataset) => {
    const config: ReplayConfig = {
      ...toCostParams(costForm, dataset.market),
      market: dataset.market,
      investment: parseNum(settings.investment),
    };
    const error = validateReplayConfig(config);
    setPlaying(false);
    setMessage(error);
    setReplay(error ? null : createReplay(config, dataset.candles, dataset.funding, parseNum(settings.warmup) || 1));
  };

  const data = useMarketData({ initialForm: () => createMarketForm(), onLoaded: (dataset) => start(dataset) });
  const { dataset } = data;

  const step = useCallback(
    (count: number) => {
      if (!dataset) return;
      setReplay((s) => {
        if (!s) return s;
        let next = s;
        for (let i = 0; i < count; i++) next = advanceReplay(next, dataset.candles, dataset.funding);
        return next;
      });
    },
    [dataset],
  );

  const total = dataset?.candles.length ?? 0;
  const cursor = replay?.cursor ?? -1;
  const finished = replay !== null && cursor >= total - 1;
  const running = playing && replay !== null && !finished;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => step(1), 1000 / speed);
    return () => clearInterval(id);
  }, [running, speed, step]);

  // 快捷键：→ 下一根，空格 播放/暂停（输入框内不响应）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, select, textarea")) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const visibleCandles = useMemo(() => (dataset && cursor >= 0 ? dataset.candles.slice(0, cursor + 1) : []), [dataset, cursor]);
  const stats = useMemo(() => (replay && dataset ? replayStats(replay, dataset.candles) : null), [replay, dataset]);

  const trades = replay?.trades;
  const markers = useMemo(() => (trades ? buildTradeMarkers(trades) : []), [trades]);

  const orders = replay?.orders;
  const position = replay?.position ?? 0;
  const avgEntry = replay?.avgEntry ?? 0;
  const priceLines = useMemo<PriceLine[]>(
    () => [
      ...(orders ?? []).map((o) => ({
        price: o.price,
        color: o.type === "limit" ? "#f0b90b" : "#a855f7",
        title: `${o.side === "buy" ? "买" : "卖"}${o.type === "limit" ? "限价" : "止损"}`,
      })),
      ...(position !== 0 ? [{ price: avgEntry, color: "#eaecef", title: position > 0 ? "多单均价" : "空单均价" }] : []),
    ],
    [orders, position, avgEntry],
  );

  const equity = replay?.equity;
  const startIndex = replay?.startIndex ?? 0;
  const investment = replay?.config.investment ?? 1;
  const curve = useMemo(() => {
    if (!equity || !dataset) return null;
    const startClose = dataset.candles[startIndex].close;
    const series: IndicatorSeries[] = [
      {
        id: "account",
        name: "账户收益率",
        color: "#3b82f6",
        values: equity.map((p) => p.equity / investment - 1),
        format: (v) => fmtPct(v),
      },
      {
        id: "hold",
        name: "同期持有",
        color: "#f0b90b",
        values: equity.map((_, i) => dataset.candles[startIndex + i].close / startClose - 1),
        format: (v) => fmtPct(v),
      },
    ];
    return { times: equity.map((p) => p.time), series };
  }, [equity, dataset, startIndex, investment]);

  const futures = replay?.config.market === "futures";
  const currentPrice = stats?.price ?? null;
  const ticketPrice = kind === "market" ? currentPrice : parseNum(orderPrice);
  const maxQty = replay && ticketPrice !== null && ticketPrice > 0 ? maxOrderQty(replay, side, ticketPrice) : 0;

  const submit = () => {
    if (!replay || !dataset || currentPrice === null) return;
    const price = kind === "market" ? currentPrice : parseNum(orderPrice);
    const amount = parseNum(orderAmount);
    if (!(price > 0)) {
      setMessage("请输入有效价格");
      return;
    }
    if (!(amount > 0)) {
      setMessage("请输入下单金额");
      return;
    }
    const result =
      kind === "market"
        ? placeMarketOrder(replay, dataset.candles, side, amount / price)
        : placePendingOrder(replay, kind, side, price, amount / price);
    setMessage(result.error);
    if (!result.error) {
      setReplay(result.state);
      setOrderAmount("");
    }
  };

  const closeAll = () => {
    if (!replay || !dataset) return;
    const result = closeReplayPosition(replay, dataset.candles);
    setMessage(result.error);
    if (!result.error) setReplay(result.state);
  };

  return (
    <SimulatorLayout
      sidebar={
        <>
          <MarketDataSection data={data} />
          <Section title="复盘设置">
            <Field label="初始资金">
              <NumberInput
                value={settings.investment}
                onChange={(investment) => patchSettings({ investment })}
                suffix="USDT"
                min={0}
              />
            </Field>
            <Field label="初始显示K线数" hint="从第 N 根K线收盘后开始复盘，之前的行情作为参考">
              <NumberInput value={settings.warmup} onChange={(warmup) => patchSettings({ warmup })} step={1} min={1} />
            </Field>
            <button
              type="button"
              onClick={() => dataset && start(dataset)}
              disabled={!dataset}
              className="h-8 w-full rounded border border-line text-sm text-fg transition-colors hover:border-accent disabled:opacity-50"
            >
              按当前设置重新开始
            </button>
            <p className="text-[11px] leading-snug text-muted">
              资金、杠杆、手续费修改后点击重新开始生效。快捷键：→ 下一根，空格 播放 / 暂停。
            </p>
          </Section>
          <CostSections
            form={costForm}
            onChange={patchCost}
            market={data.form.market}
            note="市价单与止损单按 Taker 计费，限价单按 Maker 计费。现货与合约费率分别保存。"
          />
        </>
      }
    >
      {data.error && (
        <div className="rounded-lg border border-down/40 bg-down/10 px-4 py-2.5 text-sm text-down">
          加载失败：{data.error}
        </div>
      )}

      {!dataset || !replay || !stats ? (
        <Card>
          <div className="p-10 text-center text-sm text-muted">
            {data.loading ? "正在从 Binance 加载行情…" : (message ?? "请在左侧选择行情并加载，加载后自动开始复盘")}
          </div>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-panel px-4 py-3 text-xs">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-semibold">{dataset.symbol}</span>
              <span className="rounded bg-panel-2 px-1.5 py-0.5 text-muted">{futures ? "U本位永续" : "现货"}</span>
            </div>
            <Stat label="当前K线 (UTC)" value={`${fmtDateTime(dataset.candles[cursor].time)} · ${dataset.interval}`} />
            <Stat label="最新价" value={fmtPrice(stats.price)} />
            <Stat label="进度" value={`${cursor - replay.startIndex} / ${total - 1 - replay.startIndex} 根`} />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <ControlButton onClick={() => step(1)} disabled={finished}>
                下一根 →
              </ControlButton>
              <ControlButton onClick={() => step(10)} disabled={finished}>
                +10 根
              </ControlButton>
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                disabled={finished}
                className="h-7 rounded bg-accent px-3 font-medium text-black hover:bg-accent/90 disabled:opacity-50"
              >
                {running ? "暂停" : "自动播放"}
              </button>
              <select
                className="h-7 rounded border border-line bg-panel-2 px-1 text-fg"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s} 根/秒
                  </option>
                ))}
              </select>
            </div>
            <div className="h-1 basis-full overflow-hidden rounded bg-panel-2">
              <div className="h-1 bg-accent transition-all" style={{ width: `${stats.progress * 100}%` }} />
            </div>
            {finished && <span className="basis-full text-accent">复盘结束，可查看下方统计，或在左侧重新开始。</span>}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <Card className="min-w-0">
              <KlineChart candles={visibleCandles} markers={markers} priceLines={priceLines} height={520} />
            </Card>

            <div className="space-y-4">
              <Card title="下单">
                <div className="space-y-3 p-4">
                  <Segmented<ReplaySide>
                    value={side}
                    onChange={setSide}
                    options={[
                      { value: "buy", label: futures ? "买入 / 做多" : "买入" },
                      { value: "sell", label: futures ? "卖出 / 做空" : "卖出" },
                    ]}
                  />
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
                          <NumberInput value={orderPrice} onChange={setOrderPrice} min={0} />
                        </div>
                        <SmallButton onClick={() => setOrderPrice(String(stats.price))}>最新价</SmallButton>
                      </div>
                    </Field>
                  )}
                  <Field label="金额（名义价值）">
                    <NumberInput value={orderAmount} onChange={setOrderAmount} suffix="USDT" min={0} />
                  </Field>
                  <div className="flex gap-1">
                    {AMOUNT_PRESETS.map((pct) => (
                      <SmallButton
                        key={pct}
                        onClick={() =>
                          ticketPrice && setOrderAmount(String(Math.floor(maxQty * ticketPrice * pct * 100) / 100))
                        }
                      >
                        {pct * 100}%
                      </SmallButton>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted">
                    最多可{side === "buy" ? "买" : "卖"} <span className="num">{fmtQty(maxQty)}</span>（≈{" "}
                    <span className="num">{fmtUsd(maxQty * (ticketPrice ?? 0))}</span> USDT）
                  </p>
                  <button
                    type="button"
                    onClick={submit}
                    className={`h-9 w-full rounded text-sm font-medium ${
                      side === "buy" ? "bg-up text-black hover:bg-up/90" : "bg-down text-white hover:bg-down/90"
                    }`}
                  >
                    {kind === "market" ? "市价" : kind === "limit" ? "挂限价" : "挂止损"}
                    {side === "buy" ? (futures ? "买入 / 做多" : "买入") : futures ? "卖出 / 做空" : "卖出"}
                  </button>
                  <button
                    type="button"
                    onClick={closeAll}
                    className="h-8 w-full rounded border border-line text-sm text-fg hover:border-accent"
                  >
                    一键平仓
                  </button>
                  {message && <p className="text-xs text-down">{message}</p>}
                  {replay.notice && <p className="text-xs text-accent">{replay.notice}</p>}
                </div>
              </Card>

              <Card title="账户">
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 p-4 text-xs">
                  <Metric label="权益" value={fmtUsd(stats.equity)} />
                  <Metric label="收益率" value={fmtPct(stats.returnPct)} className={pnlClass(stats.returnPct)} />
                  <Metric
                    label="持仓"
                    value={
                      replay.position === 0
                        ? "无"
                        : `${replay.position > 0 ? "多" : "空"} ${fmtQty(Math.abs(replay.position))} @ ${fmtPrice(replay.avgEntry)}`
                    }
                    className={replay.position > 0 ? "text-up" : replay.position < 0 ? "text-down" : ""}
                  />
                  <Metric label="未实现盈亏" value={fmtUsd(stats.unrealizedPnl, true)} className={pnlClass(stats.unrealizedPnl)} />
                  <Metric label="已实现盈亏" value={fmtUsd(replay.realizedPnl, true)} className={pnlClass(replay.realizedPnl)} />
                  <Metric label="手续费" value={fmtUsd(-replay.feesPaid)} className="text-down" />
                  {futures && (
                    <Metric label="资金费" value={fmtUsd(-replay.fundingPaid, true)} className={pnlClass(-replay.fundingPaid)} />
                  )}
                  <Metric label="可用 USDT" value={fmtUsd(replay.cash)} />
                  <Metric
                    label="胜率"
                    value={stats.winRate === null ? "—" : `${fmtPct(stats.winRate, false, 1)}（${stats.closedCount} 次）`}
                  />
                  <Metric label="盈亏比" value={stats.profitFactor === null ? "—" : stats.profitFactor.toFixed(2)} />
                  <Metric label="最大回撤" value={fmtPct(-replay.maxDrawdown)} className="text-down" />
                  <Metric label="同期持有" value={fmtPct(stats.holdReturn)} className={pnlClass(stats.holdReturn)} />
                  {replay.liquidation && (
                    <div className="col-span-2 rounded bg-down/15 px-2 py-1 text-down">
                      已爆仓：{fmtDateTime(replay.liquidation.time)} @ {fmtPrice(replay.liquidation.price)}
                    </div>
                  )}
                </dl>
              </Card>
            </div>
          </div>

          {curve && (
            <Card title="收益曲线" extra={<span className="text-xs text-muted">账户收益率 vs 从复盘起点持有</span>}>
              <IndicatorChart times={curve.times} series={curve.series} height={200} />
            </Card>
          )}

          <Card title={`当前挂单（${replay.orders.length}）`}>
            {replay.orders.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted">暂无挂单</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted">
                    <tr className="border-b border-line">
                      <th className="px-3 py-2 text-left font-normal">类型</th>
                      <th className="px-3 py-2 text-left font-normal">方向</th>
                      <th className="px-3 py-2 text-right font-normal">价格</th>
                      <th className="px-3 py-2 text-right font-normal">数量</th>
                      <th className="px-3 py-2 text-right font-normal">名义价值</th>
                      <th className="px-3 py-2 text-left font-normal">下单时间 (UTC)</th>
                      <th className="px-3 py-2 text-right font-normal">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {replay.orders.map((o) => (
                      <tr key={o.id} className="border-b border-line/50 last:border-b-0">
                        <td className="px-3 py-2">{o.type === "limit" ? "限价" : "止损"}</td>
                        <td className={`px-3 py-2 ${o.side === "buy" ? "text-up" : "text-down"}`}>
                          {o.side === "buy" ? "买入" : "卖出"}
                        </td>
                        <td className="num px-3 py-2 text-right">{fmtPrice(o.price)}</td>
                        <td className="num px-3 py-2 text-right">{fmtQty(o.qty)}</td>
                        <td className="num px-3 py-2 text-right">{fmtUsd(o.qty * o.price)}</td>
                        <td className="num px-3 py-2 text-muted">{fmtDateTime(dataset.candles[o.createdAt].time)}</td>
                        <td className="px-3 py-2 text-right">
                          <SmallButton onClick={() => setReplay(cancelReplayOrder(replay, o.id))}>撤单</SmallButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="成交记录">
            <TradesTable trades={replay.trades} newestFirst />
          </Card>
        </>
      )}
    </SimulatorLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted">{label}</span>
      <span className="num text-fg">{value}</span>
    </div>
  );
}

function Metric({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{label}</dt>
      <dd className={`num truncate text-fg ${className}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

function ControlButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-7 rounded border border-line px-3 text-fg hover:border-accent disabled:opacity-50"
    >
      {children}
    </button>
  );
}

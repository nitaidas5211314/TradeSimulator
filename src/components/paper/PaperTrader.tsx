"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IndicatorChart, type IndicatorSeries } from "@/components/charts/IndicatorChart";
import { KlineChart, type PriceLine } from "@/components/charts/KlineChart";
import { SimulatorLayout } from "@/components/simulator/SimulatorLayout";
import { Card, Field, NumberInput, Section, Segmented, SmallButton, inputClass } from "@/components/ui/controls";
import { fmtDuration, fmtPct, fmtPrice, fmtTime, fmtUsd, pnlClass } from "@/lib/format";
import { autoInterval, estimateCandles, loadDataset, loadSymbols } from "@/lib/market/client";
import { KLINE_INTERVALS, type KlineInterval, type MarketType, type SymbolInfo } from "@/lib/market/types";
import {
  STRATEGY_COLORS,
  backfillBook,
  bookKey,
  cancelPaperOrder,
  checkPaperOrder,
  createStrategy,
  paperReduce,
  paperStats,
  paperTrade,
  placePaperOrder,
  recordTick,
  strategySeries,
  validateStrategy,
  type PaperMetric,
  type PaperOrderType,
  type PaperSide,
  type PaperStats,
  type PaperStrategy,
  type StrategyInput,
} from "@/lib/paper/account";
import { PaperCompareTable } from "./PaperCompareTable";
import { PaperFillsTable } from "./PaperFillsTable";
import { StrategyCard, type StrategyActions } from "./StrategyCard";
import { buildPaperMarkers, downloadCsv, fillsToCsv } from "./paperExport";
import { useLiveKlines } from "./useLiveKlines";
import { useLiveTicker } from "./useLiveTicker";
import { usePaperStore } from "./usePaperStore";

const REFRESH_OPTIONS = [2, 3, 5, 10, 30];
const CHART_INTERVALS: KlineInterval[] = ["1m", "5m", "15m", "1h"];
const NAMES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** 最多回填 30 天的历史价格 */
const MAX_BACKFILL_MS = 30 * 86_400_000;
/** 图上最多画多少条均价 / 挂单线 */
const MAX_PRICE_LINES = 12;

const METRIC_OPTIONS: { value: PaperMetric; label: string; format: (v: number) => string }[] = [
  { value: "returnPct", label: "收益率", format: (v) => fmtPct(v) },
  { value: "equity", label: "权益", format: (v) => fmtUsd(v) },
  { value: "totalPnl", label: "总盈亏", format: (v) => fmtUsd(v, true) },
  { value: "unrealizedPnl", label: "未实现盈亏", format: (v) => fmtUsd(v, true) },
  { value: "realizedPnl", label: "已实现盈亏", format: (v) => fmtUsd(v, true) },
  { value: "positionValue", label: "持仓市值", format: (v) => fmtUsd(v) },
];

interface FeeInput {
  maker: string;
  taker: string;
}

interface StrategyForm {
  name: string;
  note: string;
  color: string;
  investment: string;
  leverage: string;
  fees: Record<MarketType, FeeInput>;
  maintenanceMarginRate: string;
}

const DEFAULT_FORM: StrategyForm = {
  name: "",
  note: "",
  color: STRATEGY_COLORS[0],
  investment: "10000",
  leverage: "3",
  fees: { spot: { maker: "0.1", taker: "0.1" }, futures: { maker: "0.02", taker: "0.05" } },
  maintenanceMarginRate: "0.5",
};

export default function PaperTrader() {
  const store = usePaperStore();
  // 这些回调都是稳定引用，单独取出以便作为 effect / useCallback 的依赖
  const { market, symbol, book, updateBook, updateStrategy } = store;
  const [refreshSec, setRefreshSec] = useState(3);
  const [chartInterval, setChartInterval] = useState<KlineInterval>("5m");
  const [symbolDraft, setSymbolDraft] = useState({ key: symbol, value: symbol });
  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [form, setForm] = useState<StrategyForm>(DEFAULT_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [metric, setMetric] = useState<PaperMetric>("returnPct");
  const [clock, setClock] = useState(0);
  const backfilled = useRef(new Set<string>());

  const live = useLiveTicker(market, symbol, refreshSec * 1000);
  const ticker = live.ticker;
  const price = ticker?.price ?? null;
  const futures = market === "futures";
  // 合约实时接口受限时价格已退化为现货，K线与回填也用现货，保证图价一致
  const priceMarket: MarketType = ticker?.approx ? "spot" : market;
  const klines = useLiveKlines(priceMarket, symbol, chartInterval, price, live.receivedAt);

  // 每次收到实时价格都记录采样点：撮合挂单、结算资金费、更新回撤与强平
  useEffect(() => {
    if (!ticker) return;
    updateBook((b) => recordTick(b, ticker.price, Date.now(), ticker.funding));
  }, [ticker, updateBook]);

  // 页面关闭期间没有采样点，首次进入某个币种时用K线补齐收益曲线
  useEffect(() => {
    const key = bookKey(market, symbol);
    // 每个币种每次会话只回填一次，失败也不重试，避免轮询期间反复请求
    if (backfilled.current.has(key) || !ticker) return;
    const from = book.strategies.reduce((min, s) => Math.min(min, s.openedAt ?? s.createdAt), Infinity);
    if (!Number.isFinite(from)) return;
    backfilled.current.add(key);
    const end = Date.now();
    const start = Math.max(from, end - MAX_BACKFILL_MS);
    // 时间跨度不大时用 1m，尽量还原细节
    const interval = estimateCandles(start, end, "1m") <= 1500 ? "1m" : autoInterval(start, end);
    loadDataset({ market: priceMarket, symbol, interval, start, end })
      .then((data) => updateBook((b) => backfillBook(b, data.candles)))
      .catch(() => undefined);
  }, [market, priceMarket, symbol, ticker, book.strategies, updateBook]);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadSymbols(market)
      .then((list) => !cancelled && setSymbols(list))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [market]);

  // 输入框内容跟随当前币种，用户输入期间保留草稿
  const symbolInput = symbolDraft.key === symbol ? symbolDraft.value : symbol;
  const setSymbolInput = (value: string) => setSymbolDraft({ key: symbol, value });

  // 持仓时长等指标需要随时间走动，收到行情之前以最近一次行情时间为准
  const now = Math.max(clock, live.receivedAt);
  const stats = useMemo(() => {
    const map = new Map<string, PaperStats>();
    if (price === null) return map;
    for (const s of book.strategies) map.set(s.id, paperStats(s, market, price, now));
    return map;
  }, [book.strategies, market, price, now]);

  const actionsFor = useCallback(
    (s: PaperStrategy): StrategyActions => ({
      trade: (side: PaperSide, qty: number) => {
        if (price === null) return "等待实时价格";
        const error = checkPaperOrder(s, market, side, qty, price);
        if (error) return error;
        updateStrategy(s.id, (cur) => paperTrade(cur, market, side, qty, price).strategy);
        return null;
      },
      placeOrder: (type: PaperOrderType, side: PaperSide, orderPrice: number, qty: number) => {
        const error = checkPaperOrder(s, market, side, qty, orderPrice);
        if (error) return error;
        updateStrategy(s.id, (cur) => placePaperOrder(cur, market, type, side, orderPrice, qty).strategy);
        return null;
      },
      cancelOrder: (id: number) => updateStrategy(s.id, (cur) => cancelPaperOrder(cur, id)),
      reduce: (fraction: number) => {
        if (price === null) return "等待实时价格";
        const { error } = paperReduce(s, market, fraction, price);
        if (error) return error;
        updateStrategy(s.id, (cur) => paperReduce(cur, market, fraction, price).strategy);
        return null;
      },
      edit: (patch) => updateStrategy(s.id, (cur) => ({ ...cur, ...patch })),
      remove: () => {
        if (window.confirm(`确定删除「${s.name}」及其成交记录？`)) store.removeStrategy(s.id);
      },
    }),
    [market, price, updateStrategy, store],
  );

  const closeAll = () => {
    if (price === null) return;
    for (const s of book.strategies) {
      if (s.position !== 0) updateStrategy(s.id, (cur) => paperReduce(cur, market, 1, price).strategy);
    }
  };

  const autoName = `策略 ${NAMES[book.strategies.length % NAMES.length]}`;

  const createOne = () => {
    const fees = form.fees[market];
    const input: StrategyInput = {
      name: form.name.trim() || autoName,
      color: form.color,
      note: form.note,
      investment: Number(form.investment),
      leverage: Number(form.leverage),
      feeRate: Number(fees.taker) / 100,
      makerFeeRate: Number(fees.maker) / 100,
      maintenanceMarginRate: Number(form.maintenanceMarginRate) / 100,
    };
    const error = validateStrategy(market, input);
    setFormError(error);
    if (error) return;
    store.addStrategy(createStrategy(market, input));
    const nextColor = STRATEGY_COLORS[(book.strategies.length + 1) % STRATEGY_COLORS.length];
    setForm((f) => ({ ...f, name: "", note: "", color: nextColor }));
  };

  const applySymbol = () => {
    const next = symbolInput.toUpperCase().trim();
    if (next && next !== symbol) store.setSymbol(next);
  };

  const curve = useMemo(() => {
    const { ticks, strategies } = book;
    if (ticks.length < 2 || strategies.length === 0) return null;
    const format = METRIC_OPTIONS.find((o) => o.value === metric)?.format ?? fmtUsd;
    const series: IndicatorSeries[] = strategies.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      values: strategySeries(s, ticks, metric),
      format,
    }));
    series.push({
      id: "__price",
      name: `${symbol} 价格`,
      color: "#848e9c",
      left: true,
      values: ticks.map((t) => t.price),
      format: fmtPrice,
    });
    return { times: ticks.map((t) => t.time), series };
  }, [book, metric, symbol]);

  const markers = useMemo(
    () => buildPaperMarkers(book.strategies, KLINE_INTERVALS[chartInterval]),
    [book.strategies, chartInterval],
  );

  const priceLines = useMemo<PriceLine[]>(() => {
    const lines: PriceLine[] = [];
    for (const s of book.strategies) {
      if (s.position !== 0) {
        lines.push({ price: s.avgEntry, color: s.color, title: `${s.name} ${s.position > 0 ? "多" : "空"}均价` });
      }
      for (const o of s.orders) {
        lines.push({
          price: o.price,
          color: o.type === "limit" ? "#f0b90b" : "#a855f7",
          title: `${s.name} ${o.side === "buy" ? "买" : "卖"}${o.type === "limit" ? "限价" : "止损"}`,
        });
      }
    }
    return lines.slice(0, MAX_PRICE_LINES);
  }, [book.strategies]);

  const previous = book.ticks.length > 1 ? book.ticks[book.ticks.length - 2].price : null;
  const priceTrend = price === null || previous === null ? 0 : price - previous;
  const stale = live.receivedAt > 0 && now - live.receivedAt > refreshSec * 3000;
  const liquidated = book.strategies.filter((s) => s.liquidatedAt !== null);
  const fees = form.fees[market];
  const setFee = (patch: Partial<FeeInput>) =>
    setForm((f) => ({ ...f, fees: { ...f.fees, [market]: { ...f.fees[market], ...patch } } }));

  return (
    <SimulatorLayout
      sidebar={
        <>
          <Section title="实时行情">
            <Segmented<MarketType>
              value={market}
              onChange={store.setMarket}
              options={[
                { value: "spot", label: "现货" },
                { value: "futures", label: "U本位永续合约" },
              ]}
            />
            <Field label="交易对" hint="切换币种后各自的策略与记录会单独保存">
              <div className="flex gap-1">
                <input
                  className={`${inputClass} num uppercase`}
                  list={`paper-symbols-${market}`}
                  value={symbolInput}
                  placeholder="BTCUSDT"
                  onChange={(e) => setSymbolInput(e.target.value.toUpperCase().trim())}
                  onBlur={applySymbol}
                  onKeyDown={(e) => e.key === "Enter" && applySymbol()}
                />
                <SmallButton onClick={applySymbol}>切换</SmallButton>
              </div>
              <datalist id={`paper-symbols-${market}`}>
                {symbols.map((s) => (
                  <option key={s.symbol} value={s.symbol} />
                ))}
              </datalist>
            </Field>
            <Field label="刷新频率" hint="挂单按轮询到的价格撮合，频率越高越接近真实成交">
              <select className={inputClass} value={refreshSec} onChange={(e) => setRefreshSec(Number(e.target.value))}>
                {REFRESH_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    每 {s} 秒
                  </option>
                ))}
              </select>
            </Field>
            {store.savedBooks.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {store.savedBooks.slice(0, 6).map((b) => (
                  <SmallButton
                    key={`${b.market}|${b.symbol}`}
                    onClick={() => {
                      store.setMarket(b.market);
                      store.setSymbol(b.symbol);
                    }}
                  >
                    {b.symbol}
                    <span className="ml-1 opacity-60">{b.market === "futures" ? "永续" : "现货"}</span>
                  </SmallButton>
                ))}
              </div>
            )}
          </Section>

          <Section title="新建策略">
            <Field label="策略名称">
              <input
                className={inputClass}
                value={form.name}
                placeholder={autoName}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="初始资金">
              <NumberInput
                value={form.investment}
                onChange={(investment) => setForm((f) => ({ ...f, investment }))}
                suffix="USDT"
                min={0}
              />
            </Field>
            {futures && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="杠杆倍数">
                  <NumberInput
                    value={form.leverage}
                    onChange={(leverage) => setForm((f) => ({ ...f, leverage }))}
                    suffix="x"
                    min={1}
                    max={125}
                  />
                </Field>
                <Field label="维持保证金率">
                  <NumberInput
                    value={form.maintenanceMarginRate}
                    onChange={(maintenanceMarginRate) => setForm((f) => ({ ...f, maintenanceMarginRate }))}
                    suffix="%"
                    min={0}
                  />
                </Field>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field label="挂单 Maker">
                <NumberInput value={fees.maker} onChange={(maker) => setFee({ maker })} suffix="%" min={0} />
              </Field>
              <Field label="吃单 Taker">
                <NumberInput value={fees.taker} onChange={(taker) => setFee({ taker })} suffix="%" min={0} />
              </Field>
            </div>
            <p className="text-[11px] leading-snug text-muted">
              市价单与止损单按 Taker 计费，限价挂单成交按 Maker 计费。现货与合约费率分别保存。
            </p>
            <Field label="策略思路（选填）">
              <input
                className={inputClass}
                value={form.note}
                placeholder="如：跌 3% 加仓一次"
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </Field>
            <Field label="颜色">
              <div className="flex flex-wrap gap-1.5">
                {STRATEGY_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                    style={{ background: c }}
                    className={`h-6 w-6 rounded-full transition-transform ${
                      form.color === c ? "ring-2 ring-fg ring-offset-2 ring-offset-panel" : "hover:scale-110"
                    }`}
                    aria-label={c}
                  />
                ))}
              </div>
            </Field>
            {formError && <p className="text-xs text-down">{formError}</p>}
            <button
              type="button"
              onClick={createOne}
              className="h-9 w-full rounded bg-accent text-sm font-medium text-black transition-colors hover:bg-accent/90"
            >
              创建策略
            </button>
          </Section>

          <Section title="模拟盘说明">
            <ul className="space-y-1.5 text-[11px] leading-snug text-muted">
              <li>· 价格来自 Binance 实时行情接口，按所选频率轮询，全部为模拟成交，不会下真实订单。</li>
              <li>· 所有策略共用同一条实时价格流，可对比各自建仓后的收益变化。</li>
              <li>· 限价 / 止损单在页面打开时按轮询到的价格撮合，可能错过两次轮询之间的瞬时穿刺。</li>
              <li>· 合约按杠杆检查保证金并模拟强平；资金费在页面打开且到结算时刻时按当前费率计入。</li>
              <li>· 数据保存在本浏览器，关闭页面后仍在；重新打开会用K线补齐这段时间的收益曲线。</li>
            </ul>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`确定清空 ${symbol} 的全部策略与记录？`)) {
                  backfilled.current.delete(bookKey(market, symbol));
                  store.resetBook();
                }
              }}
              className="h-8 w-full rounded border border-line text-sm text-muted transition-colors hover:border-down hover:text-down"
            >
              清空 {symbol} 模拟盘
            </button>
          </Section>
        </>
      }
    >
      {live.error && (
        <div className="rounded-lg border border-down/40 bg-down/10 px-4 py-2.5 text-sm text-down">
          行情获取失败：{live.error}
        </div>
      )}
      {liquidated.length > 0 && (
        <div className="rounded-lg border border-down/40 bg-down/10 px-4 py-2.5 text-sm text-down">
          {liquidated.map((s) => s.name).join("、")} 已爆仓，保证金全部损失。可在卡片里删除后重新创建。
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-panel px-4 py-3 text-xs">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold">{symbol}</span>
          <span className="rounded bg-panel-2 px-1.5 py-0.5 text-muted">{futures ? "U本位永续" : "现货"}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-muted">最新价</span>
          <span
            className={`num text-lg font-semibold ${priceTrend > 0 ? "text-up" : priceTrend < 0 ? "text-down" : "text-fg"}`}
          >
            {price === null ? (live.loading ? "加载中…" : "—") : fmtPrice(price)}
          </span>
        </div>
        <Stat
          label="24h 涨跌"
          value={ticker ? fmtPct(ticker.changePercent) : "—"}
          className={pnlClass(ticker?.changePercent ?? 0)}
        />
        <Stat label="24h 最高 / 最低" value={ticker ? `${fmtPrice(ticker.high)} / ${fmtPrice(ticker.low)}` : "—"} />
        <Stat label="24h 成交额" value={ticker ? `${fmtUsd(ticker.quoteVolume / 1e6)}M` : "—"} />
        {ticker?.funding && (
          <Stat
            label="当前资金费率"
            value={`${fmtPct(ticker.funding.rate, true, 4)} · ${fmtTime(ticker.funding.nextTime)} 结算`}
            className={pnlClass(-ticker.funding.rate)}
          />
        )}
        <Stat
          label="更新时间 (UTC)"
          value={live.receivedAt ? fmtTime(live.receivedAt) : "—"}
          className={stale ? "text-down" : ""}
        />
        <div className="ml-auto flex items-center gap-2">
          <SmallButton onClick={live.refresh}>立即刷新</SmallButton>
          <button
            type="button"
            onClick={closeAll}
            disabled={!book.strategies.some((s) => s.position !== 0)}
            className="h-7 rounded border border-line px-3 text-fg transition-colors hover:border-accent disabled:opacity-40"
          >
            全部平仓
          </button>
        </div>
        {ticker?.approx && (
          <p className="basis-full text-accent">
            合约实时接口受地区限制，当前用同名现货价格近似。设置 HTTPS_PROXY 代理后重启可获取真实合约价格。
          </p>
        )}
      </div>

      <Card
        title={`${symbol} 实时K线`}
        extra={
          <div className="flex items-center gap-2">
            {klines.error && <span className="text-xs text-down">{klines.error}</span>}
            <div className="w-56">
              <Segmented<KlineInterval>
                size="sm"
                value={chartInterval}
                onChange={setChartInterval}
                options={CHART_INTERVALS.map((i) => ({ value: i, label: i }))}
              />
            </div>
          </div>
        }
      >
        {klines.candles.length > 0 ? (
          <KlineChart candles={klines.candles} markers={markers} priceLines={priceLines} height={360} />
        ) : (
          <div className="px-4 py-16 text-center text-sm text-muted">
            {klines.loading ? "正在加载K线…" : "暂无K线数据"}
          </div>
        )}
      </Card>

      {book.strategies.length === 0 ? (
        <Card>
          <div className="space-y-2 p-10 text-center text-sm text-muted">
            <p>还没有策略。在左侧「新建策略」里创建多个策略，对同一币种并行建仓、减仓、平仓。</p>
            <p className="text-xs">例如：同样 10000 USDT，一个策略一次性满仓，另一个分批建仓，实时对比两者的收益率曲线。</p>
          </div>
        </Card>
      ) : (
        <>
          <Card
            title={`策略对比（${book.strategies.length}）`}
            extra={
              <span className="text-xs text-muted">
                采样 {book.ticks.length} 点
                {book.ticks.length > 1 &&
                  ` · 跨度 ${fmtDuration(book.ticks[book.ticks.length - 1].time - book.ticks[0].time)}`}
              </span>
            }
          >
            <PaperCompareTable strategies={book.strategies} stats={stats} market={market} />
          </Card>

          <Card
            title="实时对比曲线"
            extra={
              <div className="w-72">
                <Segmented<PaperMetric>
                  size="sm"
                  value={metric}
                  onChange={setMetric}
                  options={METRIC_OPTIONS.slice(0, 3).map((o) => ({ value: o.value, label: o.label }))}
                />
              </div>
            }
          >
            {curve ? (
              <IndicatorChart times={curve.times} series={curve.series} height={280} />
            ) : (
              <div className="px-4 py-10 text-center text-xs text-muted">
                建仓后开始记录，曲线从各策略首次建仓的时刻起画
              </div>
            )}
            <div className="flex flex-wrap gap-1 border-t border-line px-4 py-2">
              {METRIC_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setMetric(o.value)}
                  className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                    metric === o.value ? "border-accent text-accent" : "border-line text-muted hover:text-fg"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {book.strategies.map((s) => (
              <StrategyCard
                key={s.id}
                strategy={s}
                market={market}
                price={price}
                stats={stats.get(s.id) ?? null}
                actions={actionsFor(s)}
              />
            ))}
          </div>

          <Card
            title="成交记录"
            extra={
              <SmallButton
                onClick={() => downloadCsv(`paper-${symbol}-${market}.csv`, fillsToCsv(book.strategies))}
                title="导出全部策略的成交记录"
              >
                导出 CSV
              </SmallButton>
            }
          >
            <PaperFillsTable strategies={book.strategies} />
          </Card>
        </>
      )}
    </SimulatorLayout>
  );
}

function Stat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted">{label}</span>
      <span className={`num ${className || "text-fg"}`}>{value}</span>
    </div>
  );
}

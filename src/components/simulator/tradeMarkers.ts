import type { TradeMarker } from "@/components/charts/KlineChart";
import type { Trade, TradeAction } from "@/lib/backtest/engine";

// 关键成交在K线上显示文字，其余显示 B / S
const MARKER_LABEL: Partial<Record<TradeAction, string>> = {
  init: "建仓",
  takeProfit: "止盈",
  stopLoss: "止损",
  stop: "停止",
  hedgeOpen: "入场",
  hedgeClose: "离场",
  liquidation: "强平",
};

/** 同一根K线、同方向、同类型的成交合并为一个标记 */
export function buildTradeMarkers(trades: Trade[]): TradeMarker[] {
  const map = new Map<string, TradeMarker>();
  for (const t of trades) {
    const label = MARKER_LABEL[t.action] ?? null;
    const key = `${t.time}|${t.side}|${label}`;
    const existing = map.get(key);
    if (existing) existing.count++;
    else map.set(key, { time: t.time, side: t.side, count: 1, label });
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

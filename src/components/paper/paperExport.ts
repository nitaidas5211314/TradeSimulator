import type { TradeMarker } from "@/components/charts/KlineChart";
import { fmtDate, fmtTime } from "@/lib/format";
import type { PaperAction, PaperStrategy } from "@/lib/paper/account";

export const PAPER_ACTION_LABEL: Record<PaperAction, string> = {
  open: "建仓",
  add: "加仓",
  reduce: "减仓",
  close: "平仓",
  reverse: "反手",
  liquidation: "强制平仓",
};

/** 成交标记按K线周期归位到所在的那根K线 */
export function buildPaperMarkers(strategies: PaperStrategy[], intervalMs: number): TradeMarker[] {
  const map = new Map<string, TradeMarker>();
  for (const s of strategies) {
    for (const f of s.fills) {
      const time = Math.floor(f.time / intervalMs) * intervalMs;
      const label = PAPER_ACTION_LABEL[f.action];
      const key = `${time}|${f.side}|${label}`;
      const existing = map.get(key);
      if (existing) existing.count++;
      else map.set(key, { time, side: f.side, count: 1, label });
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

const CSV_HEADER = ["时间(UTC)", "策略", "类型", "方向", "成交价", "数量", "成交额", "手续费", "已实现盈亏"];

/** 导出全部策略的成交记录为 CSV（BOM 开头，Excel 打开不乱码） */
export function fillsToCsv(strategies: PaperStrategy[]): string {
  const rows = strategies
    .flatMap((s) => s.fills.map((f) => ({ ...f, name: s.name })))
    .sort((a, b) => a.time - b.time)
    .map((f) => [
      `${fmtDate(f.time)} ${fmtTime(f.time)}`,
      f.name,
      PAPER_ACTION_LABEL[f.action],
      f.side === "buy" ? "买入" : "卖出",
      f.price,
      f.qty,
      f.qty * f.price,
      f.fee,
      f.profit ?? "",
    ]);
  return `﻿${[CSV_HEADER, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")}`;
}

export function downloadCsv(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

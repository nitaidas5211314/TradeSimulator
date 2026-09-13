import type { StrategyResult } from "./common";

// 参数扫描：每组参数只保留用于热力图的汇总指标

export interface ScanResult {
  returnPct: number;
  maxDrawdown: number;
  /** 收益回撤比（收益率 / 最大回撤），无回撤时为 null */
  calmar: number | null;
  liquidated: boolean;
  trades: number;
}

export function toScanResult(r: StrategyResult): ScanResult {
  return {
    returnPct: r.stats.returnPct,
    maxDrawdown: r.stats.maxDrawdown,
    calmar: r.stats.maxDrawdown > 0 ? r.stats.returnPct / r.stats.maxDrawdown : null,
    liquidated: r.liquidation !== null,
    trades: r.trades.length,
  };
}

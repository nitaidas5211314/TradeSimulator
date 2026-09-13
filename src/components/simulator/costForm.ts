import type { CostParams } from "@/lib/backtest/common";
import type { MarketType } from "@/lib/market/types";

export interface FeeInputs {
  /** 百分比字符串，如 "0.1" 表示 0.1% */
  maker: string;
  taker: string;
}

/** 手续费与合约参数表单：数值保存为字符串，便于输入中间态 */
export interface CostForm {
  fees: Record<MarketType, FeeInputs>;
  leverage: string;
  /** 百分比 */
  maintenanceMarginRate: string;
  includeFunding: boolean;
}

export const DEFAULT_COST_FORM: CostForm = {
  fees: {
    spot: { maker: "0.1", taker: "0.1" },
    futures: { maker: "0.02", taker: "0.05" },
  },
  leverage: "3",
  maintenanceMarginRate: "0.5",
  includeFunding: true,
};

/** 空字符串视为无效（NaN），交给校验函数提示 */
export const parseNum = (value: string) => (value.trim() === "" ? NaN : Number(value));

export function toCostParams(form: CostForm, market: MarketType): CostParams {
  const fees = form.fees[market];
  const futures = market === "futures";
  return {
    makerFee: parseNum(fees.maker) / 100,
    takerFee: parseNum(fees.taker) / 100,
    leverage: futures ? parseNum(form.leverage) : 1,
    maintenanceMarginRate: futures ? parseNum(form.maintenanceMarginRate) / 100 : 0,
    includeFunding: futures && form.includeFunding,
  };
}

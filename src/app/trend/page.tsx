import type { Metadata } from "next";
import { TrendSimulatorLoader } from "@/components/simulator/loaders";

export const metadata: Metadata = {
  title: "趋势策略模拟器 · TradeSim",
  description: "基于 Binance 真实历史K线回测均线交叉与通道突破（海龟）策略，支持 ATR 止损与样本外检验",
};

export default function TrendPage() {
  return <TrendSimulatorLoader />;
}

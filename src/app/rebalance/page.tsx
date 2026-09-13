import type { Metadata } from "next";
import { RebalanceSimulatorLoader } from "@/components/simulator/loaders";

export const metadata: Metadata = {
  title: "组合再平衡模拟器 · TradeSim",
  description: "基于 Binance 真实历史K线回测多币种组合的定期再平衡与阈值再平衡",
};

export default function RebalancePage() {
  return <RebalanceSimulatorLoader />;
}

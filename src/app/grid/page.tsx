import type { Metadata } from "next";
import { GridSimulatorLoader } from "@/components/simulator/loaders";

export const metadata: Metadata = {
  title: "网格模拟器 · TradeSim",
  description: "基于 Binance 真实历史K线与资金费率，对比现货/合约网格与持有策略的收益",
};

export default function GridPage() {
  return <GridSimulatorLoader />;
}

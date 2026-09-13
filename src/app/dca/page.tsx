import type { Metadata } from "next";
import { DcaSimulatorLoader } from "@/components/simulator/loaders";

export const metadata: Metadata = {
  title: "定投模拟器 · TradeSim",
  description: "基于 Binance 真实历史K线，对比一次性买入、定期定额与价值平均定投的收益",
};

export default function DcaPage() {
  return <DcaSimulatorLoader />;
}

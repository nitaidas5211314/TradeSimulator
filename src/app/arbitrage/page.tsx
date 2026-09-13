import type { Metadata } from "next";
import { ArbitrageSimulatorLoader } from "@/components/simulator/loaders";

export const metadata: Metadata = {
  title: "期现套利模拟器 · TradeSim",
  description: "基于 Binance 真实现货、永续合约K线与历史资金费率，回测现货多 + 合约空的资金费率套利",
};

export default function ArbitragePage() {
  return <ArbitrageSimulatorLoader />;
}

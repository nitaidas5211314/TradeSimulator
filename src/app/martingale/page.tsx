import type { Metadata } from "next";
import { MartingaleSimulatorLoader } from "@/components/simulator/loaders";

export const metadata: Metadata = {
  title: "马丁格尔模拟器 · TradeSim",
  description: "基于 Binance 真实历史K线与资金费率，回测现货与合约马丁格尔加仓策略",
};

export default function MartingalePage() {
  return <MartingaleSimulatorLoader />;
}

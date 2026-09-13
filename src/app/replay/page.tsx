import type { Metadata } from "next";
import { ReplaySimulatorLoader } from "@/components/simulator/loaders";

export const metadata: Metadata = {
  title: "K线复盘 · TradeSim",
  description: "用 Binance 真实历史K线逐根复盘，手动下市价、限价、止损单练习交易",
};

export default function ReplayPage() {
  return <ReplaySimulatorLoader />;
}

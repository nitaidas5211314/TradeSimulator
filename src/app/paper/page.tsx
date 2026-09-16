import type { Metadata } from "next";
import { PaperTraderLoader } from "@/components/simulator/loaders";

export const metadata: Metadata = {
  title: "多策略模拟盘 · TradeSim",
  description: "对接 Binance 实时价格，对同一币种并行运行多个策略，实时对比收益率与各项指标",
};

export default function PaperPage() {
  return <PaperTraderLoader />;
}

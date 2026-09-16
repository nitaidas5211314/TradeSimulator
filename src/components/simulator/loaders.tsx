"use client";

import dynamic from "next/dynamic";

// 模拟器依赖浏览器端图表、当前日期与本地存储，关闭 SSR 避免水合不一致

export const GridSimulatorLoader = dynamic(() => import("@/components/grid/GridSimulator"), {
  ssr: false,
  loading: () => <LoadingPlaceholder />,
});

export const DcaSimulatorLoader = dynamic(() => import("@/components/dca/DcaSimulator"), {
  ssr: false,
  loading: () => <LoadingPlaceholder />,
});

export const MartingaleSimulatorLoader = dynamic(() => import("@/components/martingale/MartingaleSimulator"), {
  ssr: false,
  loading: () => <LoadingPlaceholder />,
});

export const ArbitrageSimulatorLoader = dynamic(() => import("@/components/arbitrage/ArbitrageSimulator"), {
  ssr: false,
  loading: () => <LoadingPlaceholder />,
});

export const ReplaySimulatorLoader = dynamic(() => import("@/components/replay/ReplaySimulator"), {
  ssr: false,
  loading: () => <LoadingPlaceholder />,
});

export const TrendSimulatorLoader = dynamic(() => import("@/components/trend/TrendSimulator"), {
  ssr: false,
  loading: () => <LoadingPlaceholder />,
});

export const RebalanceSimulatorLoader = dynamic(() => import("@/components/rebalance/RebalanceSimulator"), {
  ssr: false,
  loading: () => <LoadingPlaceholder />,
});

export const PaperTraderLoader = dynamic(() => import("@/components/paper/PaperTrader"), {
  ssr: false,
  loading: () => <LoadingPlaceholder />,
});

function LoadingPlaceholder() {
  return <div className="p-8 text-sm text-muted">正在加载模拟器…</div>;
}

"use client";

import dynamic from "next/dynamic";

// 模拟器依赖浏览器端图表和当前日期，关闭 SSR 避免水合不一致
const GridSimulator = dynamic(() => import("./GridSimulator"), {
  ssr: false,
  loading: () => <div className="p-8 text-sm text-muted">正在加载网格模拟器…</div>,
});

export function GridSimulatorLoader() {
  return <GridSimulator />;
}

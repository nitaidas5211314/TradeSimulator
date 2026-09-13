"use client";

import { useDeferredValue, useMemo } from "react";
import type { LoadedDataset } from "./useMarketData";

/**
 * 参数序列化为 key 后再推迟计算：只有参数真正变化才重新回测，输入时界面保持流畅。
 * params 为 null（未加载或校验失败）时不回测；run 须为稳定引用（模块级函数）。
 */
export function useSimulation<P, R>(
  dataset: LoadedDataset | null,
  params: P | null,
  run: (dataset: LoadedDataset, params: P) => R,
): R | null {
  const key = params === null ? "" : JSON.stringify(params);
  const deferredKey = useDeferredValue(key);
  const deferredDataset = useDeferredValue(dataset);
  return useMemo(
    () => (deferredDataset && deferredKey ? run(deferredDataset, JSON.parse(deferredKey) as P) : null),
    [deferredDataset, deferredKey, run],
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadDataset, loadSymbols, type MarketDataset } from "@/lib/market/client";
import type { MarketType, SymbolInfo } from "@/lib/market/types";
import { buildRequest, formKeyOf, type MarketForm } from "./marketForm";

export interface LoadedDataset extends MarketDataset {
  /** 加载时的行情表单，用于判断参数是否已修改 */
  formKey: string;
}

export type MarketDataState = ReturnType<typeof useMarketData>;

/** 行情表单、交易对列表、K线与资金费率加载 */
export function useMarketData({
  initialForm,
  onLoaded,
}: {
  initialForm: () => MarketForm;
  onLoaded?: (dataset: LoadedDataset, previous: LoadedDataset | null) => void;
}) {
  const [initial] = useState(initialForm);
  const [form, setForm] = useState(initial);
  const patch = useCallback((p: Partial<MarketForm>) => setForm((f) => ({ ...f, ...p })), []);
  const [symbolLists, setSymbolLists] = useState<Partial<Record<MarketType, SymbolInfo[]>>>({});
  const [dataset, setDataset] = useState<LoadedDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSeq = useRef(0);
  const datasetRef = useRef<LoadedDataset | null>(null);
  const symbolsRequested = useRef(new Set<MarketType>());
  const onLoadedRef = useRef(onLoaded);

  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });

  const requestInfo = useMemo(() => buildRequest(form), [form]);
  const formKey = formKeyOf(form);
  const stale = !dataset || dataset.formKey !== formKey;

  const applyLoaded = useCallback((seq: number, key: string, data: MarketDataset) => {
    if (seq !== loadSeq.current) return;
    const loaded = { ...data, formKey: key };
    const previous = datasetRef.current;
    datasetRef.current = loaded;
    setLoading(false);
    setDataset(loaded);
    onLoadedRef.current?.(loaded, previous);
  }, []);

  const applyFailed = useCallback((seq: number, err: unknown) => {
    if (seq !== loadSeq.current) return;
    setLoading(false);
    setError((err as Error).message);
  }, []);

  const load = () => {
    if (!requestInfo.request) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    loadDataset(requestInfo.request).then(
      (data) => applyLoaded(seq, formKey, data),
      (err) => applyFailed(seq, err),
    );
  };

  // 首次进入自动加载默认行情（loading 初始即为 true）
  useEffect(() => {
    const info = buildRequest(initial);
    if (!info.request) return;
    const seq = ++loadSeq.current;
    loadDataset(info.request).then(
      (data) => applyLoaded(seq, formKeyOf(initial), data),
      (err) => applyFailed(seq, err),
    );
  }, [initial, applyLoaded, applyFailed]);

  useEffect(() => {
    const market = form.market;
    if (symbolsRequested.current.has(market)) return;
    symbolsRequested.current.add(market);
    loadSymbols(market)
      .then((list) => setSymbolLists((s) => ({ ...s, [market]: list })))
      .catch(() => symbolsRequested.current.delete(market));
  }, [form.market]);

  return {
    form,
    patch,
    symbols: symbolLists[form.market] ?? [],
    requestInfo,
    dataset,
    loading,
    error,
    stale,
    load,
  };
}

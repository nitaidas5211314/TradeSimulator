"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadDataset, loadSymbols, type DatasetRequest, type MarketDataset } from "@/lib/market/client";
import type { MarketType, SymbolInfo } from "@/lib/market/types";
import { buildRequest, formKeyOf, type MarketForm } from "./marketForm";

/** 已加载的数据集；formKey 为加载时的行情表单，用于判断参数是否已修改 */
export type LoadedDataset<D extends MarketDataset = MarketDataset> = D & { formKey: string };

export type MarketDataState<D extends MarketDataset = MarketDataset> = ReturnType<typeof useMarketData<D>>;

/** 行情表单、交易对列表、K线与资金费率加载 */
export function useMarketData<D extends MarketDataset = MarketDataset>({
  initialForm,
  onLoaded,
  loader,
}: {
  initialForm: () => MarketForm;
  onLoaded?: (dataset: LoadedDataset<D>, previous: LoadedDataset<D> | null) => void;
  /** 自定义加载函数（如同时加载现货与合约），默认加载单个市场 */
  loader?: (request: DatasetRequest) => Promise<D>;
}) {
  const [initial] = useState(initialForm);
  const [loadData] = useState(() => loader ?? (loadDataset as unknown as (request: DatasetRequest) => Promise<D>));
  const [form, setForm] = useState(initial);
  const patch = useCallback((p: Partial<MarketForm>) => setForm((f) => ({ ...f, ...p })), []);
  const [symbolLists, setSymbolLists] = useState<Partial<Record<MarketType, SymbolInfo[]>>>({});
  const [dataset, setDataset] = useState<LoadedDataset<D> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSeq = useRef(0);
  const datasetRef = useRef<LoadedDataset<D> | null>(null);
  const symbolsRequested = useRef(new Set<MarketType>());
  const onLoadedRef = useRef(onLoaded);

  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });

  const requestInfo = useMemo(() => buildRequest(form), [form]);
  const formKey = formKeyOf(form);
  const stale = !dataset || dataset.formKey !== formKey;

  const applyLoaded = useCallback((seq: number, key: string, data: D) => {
    if (seq !== loadSeq.current) return;
    const loaded = { ...data, formKey: key } as LoadedDataset<D>;
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
    loadData(requestInfo.request).then(
      (data) => applyLoaded(seq, formKey, data),
      (err) => applyFailed(seq, err),
    );
  };

  // 首次进入自动加载默认行情（loading 初始即为 true）
  useEffect(() => {
    const info = buildRequest(initial);
    if (!info.request) return;
    const seq = ++loadSeq.current;
    loadData(info.request).then(
      (data) => applyLoaded(seq, formKeyOf(initial), data),
      (err) => applyFailed(seq, err),
    );
  }, [initial, loadData, applyLoaded, applyFailed]);

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

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MarketType } from "@/lib/market/types";
import { bookKey, createBook, type PaperBook, type PaperStrategy } from "@/lib/paper/account";
import { DEFAULT_STORE, loadStore, pruneBooks, saveStore, type PaperStore } from "@/lib/paper/storage";

// 模拟盘状态：按 市场|交易对 分别保存，切换币种时各自的策略与价格流互不影响

const SAVE_DEBOUNCE_MS = 2000;

export function usePaperStore() {
  const [store, setStore] = useState<PaperStore>(() => loadStore() ?? DEFAULT_STORE);

  // 每个采样点都会更新状态，写入 localStorage 做防抖
  useEffect(() => {
    const timer = setTimeout(() => saveStore(store), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [store]);

  const { market, symbol } = store;
  const key = bookKey(market, symbol);
  const book = useMemo(
    () => store.books[key] ?? createBook(market, symbol),
    // 尚未操作过的币种先给一个临时空账本，产生数据后才写入
    [store.books, key, market, symbol],
  );

  const updateBook = useCallback((fn: (book: PaperBook) => PaperBook) => {
    setStore((s) => {
      const k = bookKey(s.market, s.symbol);
      const current = s.books[k] ?? createBook(s.market, s.symbol);
      const next = fn(current);
      if (next === current) return s;
      return { ...s, books: pruneBooks({ ...s.books, [k]: next }, k) };
    });
  }, []);

  const updateStrategy = useCallback(
    (id: string, fn: (strategy: PaperStrategy) => PaperStrategy) =>
      updateBook((b) => {
        const strategies = b.strategies.map((s) => (s.id === id ? fn(s) : s));
        return strategies.some((s, i) => s !== b.strategies[i]) ? { ...b, strategies, updatedAt: Date.now() } : b;
      }),
    [updateBook],
  );

  const addStrategy = useCallback(
    (strategy: PaperStrategy) =>
      updateBook((b) => ({ ...b, strategies: [...b.strategies, strategy], updatedAt: Date.now() })),
    [updateBook],
  );

  const removeStrategy = useCallback(
    (id: string) =>
      updateBook((b) => ({ ...b, strategies: b.strategies.filter((s) => s.id !== id), updatedAt: Date.now() })),
    [updateBook],
  );

  /** 清空当前币种的策略与价格流 */
  const resetBook = useCallback(
    () => setStore((s) => ({ ...s, books: { ...s.books, [bookKey(s.market, s.symbol)]: createBook(s.market, s.symbol) } })),
    [],
  );

  const setMarket = useCallback((m: MarketType) => setStore((s) => ({ ...s, market: m })), []);
  const setSymbol = useCallback(
    (value: string) => setStore((s) => ({ ...s, symbol: value.toUpperCase().trim() })),
    [],
  );

  /** 已有记录的其他币种，便于快速切换 */
  const savedBooks = useMemo(
    () =>
      Object.values(store.books)
        .filter((b) => b.strategies.length > 0)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [store.books],
  );

  return {
    market,
    symbol,
    book,
    savedBooks,
    setMarket,
    setSymbol,
    updateBook,
    updateStrategy,
    addStrategy,
    removeStrategy,
    resetBook,
  };
}

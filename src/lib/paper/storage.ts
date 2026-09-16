import type { MarketType } from "@/lib/market/types";
import { bookKey, type PaperBook, type PaperStrategy } from "./account";

// 模拟盘数据保存在浏览器 localStorage，不会上传服务器

const STORAGE_KEY = "tradesim.paper.v1";
/** 最多保留几个币种的模拟盘，超出后丢弃最久未操作的 */
const MAX_BOOKS = 8;

export interface PaperStore {
  market: MarketType;
  symbol: string;
  books: Record<string, PaperBook>;
}

export const DEFAULT_STORE: PaperStore = { market: "spot", symbol: "BTCUSDT", books: {} };

const isArray = Array.isArray;

function isBook(value: unknown): value is PaperBook {
  const b = value as PaperBook;
  return (
    !!b &&
    typeof b === "object" &&
    (b.market === "spot" || b.market === "futures") &&
    typeof b.symbol === "string" &&
    isArray(b.strategies) &&
    isArray(b.ticks) &&
    b.strategies.every((s) => typeof s?.id === "string" && typeof s.investment === "number" && isArray(s.fills))
  );
}

/** 只保留最近操作过的若干币种，活跃币种始终保留 */
export function pruneBooks(books: Record<string, PaperBook>, activeKey: string): Record<string, PaperBook> {
  const keys = Object.keys(books);
  if (keys.length <= MAX_BOOKS) return books;
  const kept = keys
    .sort((a, b) => (books[b].updatedAt ?? 0) - (books[a].updatedAt ?? 0))
    .filter((k) => k !== activeKey)
    .slice(0, MAX_BOOKS - 1);
  return Object.fromEntries([activeKey, ...kept].filter((k) => books[k]).map((k) => [k, books[k]]));
}

/** 补齐旧版本存档缺少的字段，避免升级后读到 undefined */
function normalizeBook(book: PaperBook): PaperBook {
  return {
    ...book,
    pendingFunding: book.pendingFunding ?? null,
    strategies: book.strategies.map(
      (s): PaperStrategy => ({
        ...s,
        makerFeeRate: s.makerFeeRate ?? s.feeRate,
        openDirection: s.openDirection ?? (s.fills[0]?.side === "sell" ? -1 : s.fills.length > 0 ? 1 : 0),
        fundingPaid: s.fundingPaid ?? 0,
        orders: s.orders ?? [],
        nextOrderId: s.nextOrderId ?? 1,
        cashFlows: s.cashFlows ?? [],
        notice: s.notice ?? null,
      }),
    ),
  };
}

export function loadStore(): PaperStore | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PaperStore;
    const market = parsed.market === "futures" ? "futures" : "spot";
    const symbol = typeof parsed.symbol === "string" && parsed.symbol ? parsed.symbol : DEFAULT_STORE.symbol;
    const books: Record<string, PaperBook> = {};
    for (const [key, book] of Object.entries(parsed.books ?? {})) {
      // 键与内容不一致的记录直接丢弃，避免价格流串到别的币种
      if (isBook(book) && key === bookKey(book.market, book.symbol)) books[key] = normalizeBook(book);
    }
    return { market, symbol, books };
  } catch {
    return null;
  }
}

export function saveStore(store: PaperStore) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 容量不足或隐私模式下忽略，不影响当前会话使用
  }
}

export function clearStore() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
}

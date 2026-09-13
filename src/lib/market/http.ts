import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

// 服务端 HTTP 工具：代理、重试、缓存、并发控制

const REQUEST_TIMEOUT_MS = 20_000;

const hasProxy = Boolean(
  process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy,
);
const proxyDispatcher = hasProxy ? new EnvHttpProxyAgent() : undefined;

export class BinanceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface RequestOptions {
  timeoutMs?: number;
  /** 网络错误时的重试次数 */
  retries?: number;
}

export async function httpGet(url: string, options: RequestOptions = {}, attempt = 0): Promise<HttpResponse> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, retries = 2 } = options;
  let res: HttpResponse;
  try {
    const signal = AbortSignal.timeout(timeoutMs);
    res = proxyDispatcher
      ? await undiciFetch(url, { dispatcher: proxyDispatcher, signal })
      : await fetch(url, { cache: "no-store", signal });
  } catch (err) {
    if (attempt < retries) {
      await sleep(500 * (attempt + 1));
      return httpGet(url, options, attempt + 1);
    }
    throw new BinanceError(`无法连接 ${new URL(url).host}：${(err as Error).message}`, 502);
  }

  if (res.status === 429 && attempt < 3) {
    await sleep(1500 * (attempt + 1));
    return httpGet(url, options, attempt + 1);
  }
  return res;
}

export async function getJson<T>(url: string, options?: RequestOptions): Promise<T> {
  const res = await httpGet(url, options);
  if (!res.ok) {
    if (res.status === 451 || res.status === 403) {
      throw new BinanceError(
        `Binance 限制了服务器所在地区访问 ${new URL(url).host}（HTTP ${res.status}），可设置 HTTPS_PROXY 代理后重启`,
        res.status,
      );
    }
    const body = await res.text().catch(() => "");
    throw new BinanceError(`Binance 返回 ${res.status}：${body.slice(0, 200)}`, res.status);
  }
  return (await res.json()) as T;
}

/** 地区限制或网络不可达，适合换数据源重试 */
export function isRestrictedError(err: unknown) {
  return err instanceof BinanceError && (err.status === 451 || err.status === 403 || err.status === 502);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 简单的 LRU 缓存 */
export class LruCache<V> {
  private map = new Map<string, V>();
  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value as string);
    }
  }
}

export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

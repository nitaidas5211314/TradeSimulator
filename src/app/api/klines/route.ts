import type { NextRequest } from "next/server";
import { BinanceError, fetchKlines } from "@/lib/market/binance";
import { toCompact } from "@/lib/market/types";
import { badRequest, parseInterval, parseMarket, parseSymbol, parseTimeRange } from "@/lib/market/validate";

// GET /api/klines?market=spot|futures&symbol=BTCUSDT&interval=1h&start=<ms>&end=<ms>
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const market = parseMarket(params.get("market"));
  if (!market.ok) return badRequest(market.error);
  const symbol = parseSymbol(params.get("symbol"));
  if (!symbol.ok) return badRequest(symbol.error);
  const interval = parseInterval(params.get("interval"));
  if (!interval.ok) return badRequest(interval.error);
  const range = parseTimeRange(params.get("start"), params.get("end"));
  if (!range.ok) return badRequest(range.error);

  try {
    const { candles, source } = await fetchKlines(
      market.value,
      symbol.value,
      interval.value,
      range.value.start,
      range.value.end,
    );
    return Response.json({
      market: market.value,
      symbol: symbol.value,
      interval: interval.value,
      source,
      candles: candles.map(toCompact),
    });
  } catch (err) {
    const status = err instanceof BinanceError ? err.status : 500;
    return badRequest((err as Error).message, status);
  }
}

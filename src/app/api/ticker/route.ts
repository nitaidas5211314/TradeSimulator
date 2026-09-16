import type { NextRequest } from "next/server";
import { BinanceError, fetchTicker } from "@/lib/market/binance";
import { badRequest, parseMarket, parseSymbol } from "@/lib/market/validate";

// GET /api/ticker?market=spot|futures&symbol=BTCUSDT
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const market = parseMarket(params.get("market"));
  if (!market.ok) return badRequest(market.error);
  const symbol = parseSymbol(params.get("symbol"));
  if (!symbol.ok) return badRequest(symbol.error);

  try {
    return Response.json(await fetchTicker(market.value, symbol.value));
  } catch (err) {
    const status = err instanceof BinanceError ? err.status : 500;
    return badRequest((err as Error).message, status);
  }
}

import type { NextRequest } from "next/server";
import { BinanceError, fetchSymbols } from "@/lib/market/binance";
import { badRequest, parseMarket } from "@/lib/market/validate";

// GET /api/symbols?market=spot|futures
export async function GET(request: NextRequest) {
  const market = parseMarket(request.nextUrl.searchParams.get("market"));
  if (!market.ok) return badRequest(market.error);

  try {
    const symbols = await fetchSymbols(market.value);
    return Response.json({ market: market.value, symbols });
  } catch (err) {
    const status = err instanceof BinanceError ? err.status : 500;
    return badRequest((err as Error).message, status);
  }
}

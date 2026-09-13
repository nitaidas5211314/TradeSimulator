import type { NextRequest } from "next/server";
import { BinanceError, fetchFundingRates } from "@/lib/market/binance";
import { badRequest, parseSymbol, parseTimeRange } from "@/lib/market/validate";

// GET /api/funding?symbol=BTCUSDT&start=<ms>&end=<ms>
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = parseSymbol(params.get("symbol"));
  if (!symbol.ok) return badRequest(symbol.error);
  const range = parseTimeRange(params.get("start"), params.get("end"));
  if (!range.ok) return badRequest(range.error);

  try {
    const { rates, source, estimatedFrom } = await fetchFundingRates(symbol.value, range.value.start, range.value.end);
    return Response.json({ symbol: symbol.value, source, estimatedFrom, rates });
  } catch (err) {
    const status = err instanceof BinanceError ? err.status : 500;
    return badRequest((err as Error).message, status);
  }
}

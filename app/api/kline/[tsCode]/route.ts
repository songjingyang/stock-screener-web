import { NextResponse, type NextRequest } from "next/server";
import { getKline } from "@/lib/data/kline-cache";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: { tsCode: string } }
) {
  const tsCode = decodeURIComponent(params.tsCode);
  const lookback = Number(req.nextUrl.searchParams.get("lookback") ?? 400);
  try {
    const kline = await getKline(tsCode, lookback);
    return NextResponse.json({ ok: true, tsCode, kline });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: (err as Error).message },
      { status: 500 }
    );
  }
}

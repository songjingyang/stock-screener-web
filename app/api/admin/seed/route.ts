/**
 * 一次性管理端点：往生产数据库写入内置股票池 + 内置策略
 *
 * 鉴权：
 *   header: authorization: Bearer <CRON_SECRET>
 *
 * 调用：
 *   curl -X POST -H "authorization: Bearer $CRON_SECRET" \
 *     https://<域名>/api/admin/seed
 *
 * 幂等：内部使用 upsert，重复调用安全。
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { BUILTIN_POOL, inferBoard } from "@/lib/data/universe";
import { BUILTIN_STRATEGIES } from "@/lib/screener/presets";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json(
      { ok: false, message: "unauthorized" },
      { status: 401 }
    );
  }

  let stockCount = 0;
  for (const s of BUILTIN_POOL) {
    const board = inferBoard(s.symbol);
    await prisma.stock.upsert({
      where: { tsCode: s.tsCode },
      update: {
        name: s.name,
        industry: s.industry,
        market: s.market,
        symbol: s.symbol,
        board,
      },
      create: {
        tsCode: s.tsCode,
        symbol: s.symbol,
        name: s.name,
        industry: s.industry,
        market: s.market,
        board,
      },
    });
    stockCount++;
  }

  let strategyCount = 0;
  for (const st of BUILTIN_STRATEGIES) {
    await prisma.strategy.upsert({
      where: { name: st.name },
      update: {
        description: st.description,
        ruleConfig: JSON.stringify(st.ruleConfig),
      },
      create: {
        name: st.name,
        description: st.description,
        ruleConfig: JSON.stringify(st.ruleConfig),
      },
    });
    strategyCount++;
  }

  return NextResponse.json({
    ok: true,
    stockCount,
    strategyCount,
    message: "seed 完成",
  });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

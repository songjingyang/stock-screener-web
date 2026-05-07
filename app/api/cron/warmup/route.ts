/**
 * K 线缓存暖机 cron
 *
 * 解决：生产 Postgres 是空的，全 A 股 5500+ 只首次扫描每只都要现拉腾讯接口，
 *      远超 Vercel Hobby 60s 函数上限，导致大量股票扫描失败。
 *
 * 策略：每次挑选 K 线最旧 / 未缓存 的若干只（按 batchSize），调 getKline 拉取
 *      增量（已有的只补昨日；全空的拉 400 自然日历史），自动落库。
 *      多次运行后整个市场 K 线库会逐步暖热。
 *
 * 配置：vercel.json 默认每 5 分钟跑一次 → 5500 / 400 ≈ 14 次（≈ 70 分钟）
 *      可在生产环境通过查询参数 batch_size 临时调整。
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getKlineBatch } from "@/lib/data/kline-cache";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const DEFAULT_BATCH = 400;

async function handle(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json(
      { ok: false, message: "unauthorized" },
      { status: 401 }
    );
  }

  const url = new URL(req.url);
  const batchSize = Math.max(
    50,
    Math.min(800, Number(url.searchParams.get("batch_size")) || DEFAULT_BATCH)
  );

  const t0 = Date.now();

  // 1) 取出所有股票 + 各自最新 K 线日期
  const stocks = await prisma.stock.findMany({ select: { tsCode: true } });
  if (!stocks.length) {
    return NextResponse.json({
      ok: true,
      message: "Stock 表为空，跳过暖机",
      processed: 0,
    });
  }

  // groupBy 一次拿所有 tsCode 的最大 tradeDate
  const klineLatest = await prisma.klineDaily.groupBy({
    by: ["tsCode"],
    _max: { tradeDate: true },
  });
  const lastMap = new Map<string, string>();
  for (const r of klineLatest) {
    if (r._max.tradeDate) lastMap.set(r.tsCode, r._max.tradeDate);
  }

  // 2) 排序：完全未缓存 → 最旧 → 最新；取前 batchSize 只
  const sorted = stocks
    .map((s) => ({
      tsCode: s.tsCode,
      last: lastMap.get(s.tsCode) ?? "",
    }))
    .sort((a, b) => a.last.localeCompare(b.last));

  const candidates = sorted.slice(0, batchSize).map((s) => s.tsCode);
  const uncachedCount = sorted.filter((s) => !s.last).length;

  // 3) 拉 K 线（getKline 内部对已缓存做增量；空缓存做全量）
  let okCount = 0;
  let failCount = 0;
  await getKlineBatch(candidates, 400, (_d, _t, _code, ok) => {
    if (ok) okCount++;
    else failCount++;
  });

  const elapsed = Date.now() - t0;
  const remaining = Math.max(0, sorted.length - batchSize);

  return NextResponse.json({
    ok: true,
    processed: candidates.length,
    success: okCount,
    failed: failCount,
    uncachedRemaining: Math.max(0, uncachedCount - candidates.length),
    queueRemaining: remaining,
    elapsedMs: elapsed,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

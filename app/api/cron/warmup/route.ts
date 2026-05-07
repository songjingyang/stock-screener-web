/**
 * K 线缓存暖机 cron —— 链式自触发模式
 *
 * 背景：
 *   - Vercel Hobby 限制：cron 每天最多 1 次 + 单次函数 60s
 *   - 全市场 5500 只一次跑完不可能（约需 5–7 分钟）
 *
 * 设计（KISS）：
 *   - cron 每天 03:00（A 股收盘后 + Neon 数据库低峰期）触发首次 invocation
 *   - 单次 invocation 在 50s budget 内尽量多跑批次（每批 200 只，约 13s/批）
 *   - 时间不够 / 还有剩余未暖时，用 fetch keepalive 自触发 /api/cron/warmup
 *     立即返回；新 invocation 与原 cron 无关，不算「一天多次 cron」
 *   - 链式调用直到剩余 = 0，单天即可暖完全市场
 *
 * 安全：
 *   - 鉴权用 CRON_SECRET（与 daily-scan 一致）
 *   - 链式调用透传相同 authorization header
 *   - hop 计数防失控：?hop=N，超过 60 跳直接停（兜底，约 200 分钟）
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getKlineBatch } from "@/lib/data/kline-cache";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BATCH_SIZE = 200;
const TIME_BUDGET_MS = 50_000;
const MAX_HOPS = 60;

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
  const hop = Number(url.searchParams.get("hop") ?? "0") || 0;
  const t0 = Date.now();

  // 1) 取股票池 + 每只最新 K 线日期
  const [stocks, klineLatest] = await Promise.all([
    prisma.stock.findMany({ select: { tsCode: true } }),
    prisma.klineDaily.groupBy({
      by: ["tsCode"],
      _max: { tradeDate: true },
    }),
  ]);
  if (!stocks.length) {
    return NextResponse.json({
      ok: true,
      message: "Stock 表为空，跳过暖机",
      hop,
      processed: 0,
    });
  }

  const lastMap = new Map<string, string>();
  for (const r of klineLatest) {
    if (r._max.tradeDate) lastMap.set(r.tsCode, r._max.tradeDate);
  }

  // 当天数据视为已暖（避免无意义重拉，让链式更快收敛）
  const todayStr = (() => {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(new Date()).replace(/-/g, "");
  })();

  const queue = stocks
    .map((s) => ({ tsCode: s.tsCode, last: lastMap.get(s.tsCode) ?? "" }))
    .filter((s) => s.last < todayStr)
    .sort((a, b) => a.last.localeCompare(b.last));

  if (!queue.length) {
    return NextResponse.json({
      ok: true,
      message: "全市场 K 线已是当天数据，本日暖机结束",
      hop,
      processed: 0,
      remaining: 0,
    });
  }

  // 2) 在 budget 内跑多批
  let processed = 0;
  let okCount = 0;
  let failCount = 0;
  let cursor = 0;
  while (cursor < queue.length && Date.now() - t0 < TIME_BUDGET_MS) {
    const batch = queue.slice(cursor, cursor + BATCH_SIZE).map((s) => s.tsCode);
    cursor += batch.length;

    await getKlineBatch(batch, 400, (_d, _t, _code, ok) => {
      if (ok) okCount++;
      else failCount++;
    });
    processed += batch.length;

    // 单批 ~13s。剩余 budget < 15s 就别再起新批，留 buffer 收尾
    if (Date.now() - t0 + 15_000 > TIME_BUDGET_MS) break;
  }

  const remaining = Math.max(0, queue.length - processed);
  const elapsed = Date.now() - t0;

  // 3) 链式自触发（不阻塞当前响应）
  let chained = false;
  if (remaining > 0 && hop + 1 < MAX_HOPS) {
    const host =
      process.env.VERCEL_PROJECT_PRODUCTION_URL ||
      process.env.VERCEL_URL ||
      url.host;
    const nextUrl = `https://${host}/api/cron/warmup?hop=${hop + 1}`;
    // keepalive: function freeze 前包发出，新 invocation 由 Vercel 接管
    fetch(nextUrl, {
      method: "POST",
      headers: { authorization: auth },
      keepalive: true,
      cache: "no-store",
    }).catch(() => {});
    chained = true;
  }

  return NextResponse.json({
    ok: true,
    hop,
    processed,
    success: okCount,
    failed: failCount,
    remaining,
    chained,
    elapsedMs: elapsed,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

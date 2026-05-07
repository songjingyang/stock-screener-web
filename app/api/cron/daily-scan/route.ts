/**
 * Vercel Cron 每日扫描入口
 *
 * 工作流：
 *   1) 鉴权（Vercel Cron 请求 header 自带 authorization: Bearer <CRON_SECRET>）
 *   2) 拉取股票池（默认内置）
 *   3) 对所有内置策略各跑一次扫描，结果落库
 *
 * 配置：vercel.json 已设定每个工作日 UTC 08:30（北京时间 16:30）触发。
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { runScan } from "@/lib/screener/runner";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel Pro: 5min；Hobby 10s 时建议改为 batch 模式

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ ok: false, message: "unauthorized" }, { status: 401 });
  }

  const stocks = await prisma.stock.findMany({ select: { tsCode: true } });
  const tsCodes = stocks.map((s) => s.tsCode);

  const strategies = await prisma.strategy.findMany();
  const summaries: Array<{
    strategy: string;
    scanRunId?: string;
    hitCount: number;
    total: number;
  }> = [];

  for (const st of strategies) {
    try {
      const out = await runScan({
        strategyId: st.id,
        tsCodes,
        persist: true,
      });
      summaries.push({
        strategy: st.name,
        scanRunId: out.scanRunId,
        hitCount: out.hitCount,
        total: out.total,
      });
    } catch (err) {
      console.error(`[cron] 策略 ${st.name} 失败:`, err);
      summaries.push({
        strategy: st.name,
        hitCount: 0,
        total: tsCodes.length,
      });
    }
  }

  return NextResponse.json({ ok: true, summaries });
}

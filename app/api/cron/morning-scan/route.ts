/**
 * Vercel Cron 早间开盘前扫描入口
 *
 * 工作流：
 *   1) 鉴权（Vercel Cron 请求 header 自带 authorization: Bearer <CRON_SECRET>）
 *   2) 调用 runMorningScan：全 A 股 + 全指标共振 + 实时合并集合竞价价 + 落库
 *
 * 调度：vercel.json 已设定每个工作日 UTC 01:25（北京时间 09:25 集合竞价）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { runMorningScan } from "@/lib/scheduled/morning-scan";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json(
      { ok: false, message: "unauthorized" },
      { status: 401 }
    );
  }
  const r = await runMorningScan();
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}

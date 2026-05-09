"use server";

import { prisma } from "@/lib/db/prisma";
import { runScan } from "@/lib/screener/runner";
import { BUILTIN_POOL, toTsCode } from "@/lib/data/universe";
import { revalidatePath } from "next/cache";
import { toCalDate } from "@/lib/data/kline-cache";

/**
 * 客户端分批扫描配套 server actions
 *
 * 设计动机：
 *   - Vercel Hobby 单 server action 60s 上限
 *   - 全 A 股 5500 只首次冷拉腾讯 K 线 + Postgres 写入约 5 分钟，必然超时
 *   - 解决：前端切 chunk（默认 600 只 / 批），顺序调 runScanChunk，
 *     每批 60s 内完成；最后聚合落库一次
 */

export interface SerializedItem {
  tsCode: string;
  name?: string;
  industry?: string;
  board?: string;
  pass: boolean;
  score: number;
  maxScore: number;
  close: number;
  volRatio: number | null;
  recentCloses?: number[];
  conditions: { label: string; pass: boolean }[];
}

export type PoolType = "builtin" | "full" | "watchlist" | "custom";

export interface PoolResolveResult {
  ok: boolean;
  message?: string;
  tsCodes?: string[];
}

export interface ChunkResult {
  ok: boolean;
  message?: string;
  items?: SerializedItem[];
  failed?: string[];
  scanDate?: string;
}

export interface PersistResult {
  ok: boolean;
  message?: string;
  scanRunId?: string;
}

/**
 * 解析股票池为 tsCode[]，独立成 server action 让前端拿到完整列表后再切片
 */
export async function resolvePoolTsCodes(input: {
  poolType: PoolType;
  customCodes?: string;
}): Promise<PoolResolveResult> {
  const { poolType, customCodes = "" } = input;

  if (poolType === "builtin") {
    const builtinSet = new Set(BUILTIN_POOL.map((s) => s.tsCode));
    const list = await prisma.stock.findMany({
      where: { tsCode: { in: Array.from(builtinSet) } },
      select: { tsCode: true },
    });
    return { ok: true, tsCodes: list.map((s) => s.tsCode) };
  }

  if (poolType === "full") {
    const list = await prisma.stock.findMany({ select: { tsCode: true } });
    const tsCodes = list.map((s) => s.tsCode);
    if (tsCodes.length < 200) {
      return {
        ok: false,
        message:
          "全 A 股池为空或过少，请先点击『同步全 A 股』按钮（约 10 秒，免费、无 token）",
      };
    }
    return { ok: true, tsCodes };
  }

  if (poolType === "watchlist") {
    const list = await prisma.watchlist.findMany({ select: { tsCode: true } });
    const tsCodes = list.map((w) => w.tsCode);
    if (!tsCodes.length) return { ok: false, message: "自选股为空" };
    return { ok: true, tsCodes };
  }

  // custom
  const lines = customCodes
    .split(/[\s,，;；]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const set = new Set<string>();
  for (const ln of lines) {
    const code = toTsCode(ln);
    if (code) set.add(code);
  }
  const tsCodes = Array.from(set);
  if (!tsCodes.length) return { ok: false, message: "未识别到合法代码" };
  return { ok: true, tsCodes };
}

/**
 * 扫描一个 chunk（不落库）。失败仅返回 message，不抛错让客户端可继续下一批
 */
export async function runScanChunk(input: {
  strategyId: string;
  tsCodes: string[];
  /** 是否强制重拉今日 K 线 */
  forceRefresh?: boolean;
}): Promise<ChunkResult> {
  if (!input.strategyId) return { ok: false, message: "缺少 strategyId" };
  if (!input.tsCodes?.length) return { ok: false, message: "tsCodes 为空" };

  try {
    const out = await runScan({
      strategyId: input.strategyId,
      tsCodes: input.tsCodes,
      persist: false,
      forceRefresh: !!input.forceRefresh,
    });
    return {
      ok: true,
      scanDate: out.scanDate,
      failed: out.failed,
      items: out.items.map((it) => ({
        tsCode: it.tsCode,
        name: it.name,
        industry: it.industry,
        board: it.board,
        pass: it.result.pass,
        score: it.result.score,
        maxScore: it.result.maxScore,
        close: it.result.context.close,
        volRatio: it.result.context.volRatio,
        recentCloses: it.recentCloses,
        conditions: it.result.conditions.map((c) => ({
          label: c.label,
          pass: c.pass,
        })),
      })),
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/**
 * 落库专用的精简 item：仅包含 ScanResult 表 / 历史详情页 实际需要的字段。
 *
 * 设计动机：原 SerializedItem 含 30 日 closes、conditions labels、industry 等
 * UI 渲染字段，5500 只一次性回传 server action 会突破 2 MB body limit。
 */
export interface PersistItem {
  tsCode: string;
  score: number;
  pass: boolean;
  close: number;
}

/**
 * 把客户端聚合后的扫描结果一次性写入 ScanRun（如用户勾选了存历史）
 */
export async function persistScanResults(input: {
  strategyId: string;
  scanDate: string;
  items: PersistItem[];
  totalCount: number;
}): Promise<PersistResult> {
  try {
    const sorted = [...input.items].sort((a, b) => b.score - a.score);
    const hits = sorted.filter((s) => s.pass).length;
    const run = await prisma.scanRun.create({
      data: {
        strategyId: input.strategyId,
        scanDate: input.scanDate || toCalDate(),
        hitCount: hits,
        totalCount: input.totalCount,
        results: {
          create: sorted.map((s) => ({
            tsCode: s.tsCode,
            score: s.score,
            pass: s.pass,
            detail: JSON.stringify({ context: { close: s.close } }),
          })),
        },
      },
    });
    revalidatePath("/");
    revalidatePath("/history");
    return { ok: true, scanRunId: run.id };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

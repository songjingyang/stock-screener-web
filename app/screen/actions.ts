"use server";

import { prisma } from "@/lib/db/prisma";
import { runScan, type FailedItem } from "@/lib/screener/runner";
import { BUILTIN_POOL, toTsCode } from "@/lib/data/universe";
import { revalidatePath } from "next/cache";

export interface ScanFormState {
  ok: boolean;
  message?: string;
  scanRunId?: string;
  scanDate?: string;
  hitCount?: number;
  total?: number;
  results?: Array<{
    tsCode: string;
    name?: string;
    industry?: string;
    board?: string;
    pass: boolean;
    score: number;
    maxScore: number;
    close: number;
    volRatio: number | null;
    /** 最近 30 个交易日收盘（含当前 close），用于 UI 绘制迷你走势图 */
    recentCloses?: number[];
    conditions: Array<{ label: string; pass: boolean }>;
  }>;
  failed?: string[];
  /** 失败明细：按原因分类（no_kline / insufficient / evaluate_error） */
  failedDetail?: FailedItem[];
}

export async function scanAction(formData: FormData): Promise<ScanFormState> {
  const strategyId = formData.get("strategyId") as string;
  const poolType = formData.get("poolType") as string;
  const customCodes = (formData.get("customCodes") as string) ?? "";
  const persist = formData.get("persist") === "1";

  if (!strategyId) {
    return { ok: false, message: "请选择策略" };
  }

  let tsCodes: string[] = [];
  if (poolType === "builtin") {
    // 内置精选：以代码常量为准，过滤 Stock 表
    const builtinSet = new Set(BUILTIN_POOL.map((s) => s.tsCode));
    const list = await prisma.stock.findMany({
      where: { tsCode: { in: Array.from(builtinSet) } },
      select: { tsCode: true },
    });
    tsCodes = list.map((s) => s.tsCode);
  } else if (poolType === "full") {
    // 全 A 股：Stock 表中所有；要求先调用过 syncFullUniverse
    const list = await prisma.stock.findMany({ select: { tsCode: true } });
    tsCodes = list.map((s) => s.tsCode);
    if (tsCodes.length < 200) {
      return {
        ok: false,
        message:
          "全 A 股池为空或过少，请先点击『同步全 A 股』按钮（约 10 秒，免费、无 token）",
      };
    }
  } else if (poolType === "watchlist") {
    const list = await prisma.watchlist.findMany({ select: { tsCode: true } });
    tsCodes = list.map((w) => w.tsCode);
    if (!tsCodes.length) return { ok: false, message: "自选股为空" };
  } else if (poolType === "custom") {
    const lines = customCodes
      .split(/[\s,，;；]+/)
      .map((l) => l.trim())
      .filter(Boolean);
    const set = new Set<string>();
    for (const ln of lines) {
      const code = toTsCode(ln);
      if (code) set.add(code);
    }
    tsCodes = Array.from(set);
    if (!tsCodes.length) return { ok: false, message: "未识别到合法代码" };
  }

  try {
    const out = await runScan({ strategyId, tsCodes, persist });
    if (persist) revalidatePath("/");
    return {
      ok: true,
      scanRunId: out.scanRunId,
      scanDate: out.scanDate,
      hitCount: out.hitCount,
      total: out.total,
      failed: out.failed,
      failedDetail: out.failedDetail,
      results: out.items.map((it) => ({
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

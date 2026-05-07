"use server";

import { prisma } from "@/lib/db/prisma";
import { fetchAllAStocks, fetchAllIndustryMap } from "@/lib/data/stock-list";
import { inferBoard } from "@/lib/data/universe";
import { revalidatePath } from "next/cache";

export interface SyncResult {
  ok: boolean;
  message?: string;
  total?: number;
  inserted?: number;
  updated?: number;
  industryCovered?: number;
  durationMs?: number;
}

/**
 * 一键同步全 A 股到 Stock 表（含板块、行业）
 *
 * 流程：
 *   1) 新浪 hs_a 节点拉股票列表（≈ 6-10s）
 *   2) 新浪行业节点拉 ts_code → industry 映射（≈ 5-10s）
 *   3) 每只股票根据代码本地推断 board，与 industry 一并 upsert
 *
 * 整体耗时通常 10-20 秒，免费、无 token。
 */
export async function syncFullUniverse(): Promise<SyncResult> {
  const t0 = Date.now();

  // 1) 拉股票列表
  let remote;
  try {
    remote = await fetchAllAStocks();
  } catch (err) {
    return { ok: false, message: `拉取股票列表失败：${(err as Error).message}` };
  }
  if (!remote.length) return { ok: false, message: "未拉到任何股票" };

  // 2) 拉行业映射（失败时降级为空映射，不阻断）
  let industryMap: Map<string, string>;
  try {
    industryMap = await fetchAllIndustryMap();
  } catch (err) {
    console.warn("[sync] 行业拉取失败，使用空映射:", (err as Error).message);
    industryMap = new Map();
  }

  // 3) upsert
  const existing = await prisma.stock.findMany({ select: { tsCode: true } });
  const existSet = new Set(existing.map((s) => s.tsCode));

  let inserted = 0;
  let updated = 0;
  let industryCovered = 0;

  const BATCH = 200;
  for (let i = 0; i < remote.length; i += BATCH) {
    const batch = remote.slice(i, i + BATCH);
    await prisma.$transaction(
      batch.map((s) => {
        const industry = industryMap.get(s.tsCode);
        const board = inferBoard(s.symbol);
        if (industry) industryCovered++;
        return prisma.stock.upsert({
          where: { tsCode: s.tsCode },
          create: {
            tsCode: s.tsCode,
            symbol: s.symbol,
            name: s.name,
            market: s.market,
            industry: industry ?? null,
            board,
          },
          update: {
            name: s.name,
            market: s.market,
            symbol: s.symbol,
            industry: industry ?? null,
            board,
          },
        });
      })
    );
    for (const s of batch) {
      if (existSet.has(s.tsCode)) updated++;
      else inserted++;
    }
  }

  revalidatePath("/screen");
  revalidatePath("/");
  return {
    ok: true,
    total: remote.length,
    inserted,
    updated,
    industryCovered,
    durationMs: Date.now() - t0,
  };
}

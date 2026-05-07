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
 *   3) 计算本地需要新增 / 更新的部分，用 createMany / executeRaw 批量写入
 *
 * 性能：
 *   单条 upsert × 5500 条 = 5500 次往返 ≈ 60s（曾在 Vercel Hobby
 *   60s 函数上限处被截断，导致只入库一部分）。
 *   现改为 createMany({ skipDuplicates }) 单 SQL 写入 + 单 SQL 行业批改，
 *   全程 < 15s，远低于函数上限。幂等：重复点击只补差。
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

  // 3) 计算每条记录的最终字段
  const records = remote.map((s) => ({
    tsCode: s.tsCode,
    symbol: s.symbol,
    name: s.name,
    market: s.market,
    industry: industryMap.get(s.tsCode) ?? null,
    board: inferBoard(s.symbol),
  }));
  const industryCovered = records.filter((r) => r.industry).length;

  // 3a) 找出已存在的 tsCode，仅对增量做 createMany
  //     —— 避开 skipDuplicates（SQLite 不支持，避免本地报错）
  const existing = await prisma.stock.findMany({ select: { tsCode: true } });
  const existSet = new Set(existing.map((s) => s.tsCode));
  const toCreate = records.filter((r) => !existSet.has(r.tsCode));
  let inserted = 0;
  if (toCreate.length > 0) {
    // PostgreSQL 单条 SQL；SQLite prisma 5.x 也支持但内部会拆批，依然远快于逐条 upsert
    const r = await prisma.stock.createMany({ data: toCreate });
    inserted = r.count;
  }

  // 3b) 已有股票批量补充 industry / board（仅当原值为空，避免覆盖手工标注）
  //     用 prisma.$transaction 把每个 updateMany 合并到一个事务里降低往返。
  //     按 industry 分组（< 100 个一级行业），每组一条 SQL。
  const byIndustry = new Map<string, string[]>();
  for (const r of records) {
    if (!r.industry) continue;
    let arr = byIndustry.get(r.industry);
    if (!arr) {
      arr = [];
      byIndustry.set(r.industry, arr);
    }
    arr.push(r.tsCode);
  }
  if (byIndustry.size > 0) {
    await prisma.$transaction(
      Array.from(byIndustry.entries()).map(([industry, tsCodes]) =>
        prisma.stock.updateMany({
          where: { tsCode: { in: tsCodes }, industry: null },
          data: { industry },
        })
      )
    );
  }
  // 板块（board）批量补全（按 board 分组，最多 6 组）
  const byBoard = new Map<string, string[]>();
  for (const r of records) {
    if (!r.board) continue;
    let arr = byBoard.get(r.board);
    if (!arr) {
      arr = [];
      byBoard.set(r.board, arr);
    }
    arr.push(r.tsCode);
  }
  if (byBoard.size > 0) {
    await prisma.$transaction(
      Array.from(byBoard.entries()).map(([board, tsCodes]) =>
        prisma.stock.updateMany({
          where: { tsCode: { in: tsCodes }, board: null },
          data: { board },
        })
      )
    );
  }

  // updated ≈ records.length - inserted（已存在的部分；准确数对 UI 不重要）
  const updated = Math.max(0, records.length - inserted);

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

/**
 * 构建期一次性补齐全 A 股股票池
 *
 * 触发条件：仅在 Vercel 构建容器内（VERCEL=1）+ 当前 Postgres 中股票数 < 5000 时执行
 *
 * 设计理由：
 *   - 用户在生产环境点【同步全 A 股】曾因 60s 函数超时被截断
 *   - 改用 createMany 后已 < 15s，但仍依赖用户手动点击
 *   - 在构建期完成此操作 = 部署即可用，零交互
 *
 * 幂等：判断股票数阈值后再决定是否跑；新增逻辑也只对增量做 createMany
 */
import { PrismaClient } from "@prisma/client";
import { fetchAllAStocks, fetchAllIndustryMap } from "../lib/data/stock-list";
import { inferBoard } from "../lib/data/universe";

const prisma = new PrismaClient();

const SHOULD_RUN = !!process.env.VERCEL;
const THRESHOLD = 5000;

async function main() {
  if (!SHOULD_RUN) {
    console.log("[sync-build] 非 Vercel 环境，跳过全 A 股同步（本地不污染 SQLite）");
    return;
  }

  const before = await prisma.stock.count();
  if (before >= THRESHOLD) {
    console.log(`[sync-build] 已有 ${before} 只股票（≥ ${THRESHOLD}），跳过`);
    return;
  }

  console.log(`[sync-build] 当前 ${before} 只股票，开始拉取全 A 股...`);
  const t0 = Date.now();

  const remote = await fetchAllAStocks().catch((e) => {
    console.error("[sync-build] 拉取股票列表失败:", e?.message ?? e);
    return [] as Awaited<ReturnType<typeof fetchAllAStocks>>;
  });
  if (!remote.length) {
    console.warn("[sync-build] 远端股票列表为空，跳过本次同步");
    return;
  }

  const industryMap = await fetchAllIndustryMap().catch((e) => {
    console.warn("[sync-build] 行业映射拉取失败:", e?.message ?? e);
    return new Map<string, string>();
  });

  const records = remote.map((s) => ({
    tsCode: s.tsCode,
    symbol: s.symbol,
    name: s.name,
    market: s.market,
    industry: industryMap.get(s.tsCode) ?? null,
    board: inferBoard(s.symbol),
  }));

  const existing = await prisma.stock.findMany({ select: { tsCode: true } });
  const existSet = new Set(existing.map((s) => s.tsCode));
  const toCreate = records.filter((r) => !existSet.has(r.tsCode));

  let inserted = 0;
  if (toCreate.length > 0) {
    const r = await prisma.stock.createMany({ data: toCreate });
    inserted = r.count;
  }

  // 行业按值分组批量补全（仅当原值为空，避免覆盖手工修改）
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

  // 板块按值分组批量补全
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

  const after = await prisma.stock.count();
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `[sync-build] 完成：新增 ${inserted}，行业覆盖 ${
      records.filter((r) => r.industry).length
    }，总数 ${before} → ${after}，耗时 ${dt}s`
  );
}

main()
  .catch((e) => {
    // 同步失败不应阻断 build；用户仍可在页面手动点同步
    console.error("[sync-build] 失败（不阻断构建）：", e);
  })
  .finally(() => prisma.$disconnect());

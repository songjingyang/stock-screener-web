"use server";

import { prisma } from "@/lib/db/prisma";
import { fetchTencentQuote } from "@/lib/data/tencent";
import { inferBoard, inferMarket, toTsCode } from "@/lib/data/universe";

export interface StockCandidate {
  tsCode: string;
  name: string;
  board: string | null;
  industry: string | null;
  /** 数据来源：db 表内查到 / remote 实时报价兜底 */
  source: "db" | "remote";
}

/**
 * 个股搜索：
 *   - 优先 6 位代码 / 带后缀代码精确匹配
 *   - 否则按名称 contains（中文 / 拼音）模糊
 *   - 数据库都没命中 → 若是有效 6 位代码 → 走腾讯实时报价兜底
 *
 * 设计动机（KISS）：复用已有的 toTsCode + fetchTencentQuote，
 * 不引入额外的拼音库或全文索引，覆盖 95% 以上的输入情形。
 */
export async function searchStock(
  query: string,
  limit = 8
): Promise<StockCandidate[]> {
  const raw = (query ?? "").trim();
  if (!raw) return [];

  // 1) 代码精确匹配（"600519" / "600519.SH" / "sh600519"）
  const exactCode = toTsCode(raw);
  if (exactCode) {
    const hit = await prisma.stock.findUnique({
      where: { tsCode: exactCode },
    });
    if (hit) {
      return [
        {
          tsCode: hit.tsCode,
          name: hit.name,
          board: hit.board ?? null,
          industry: hit.industry ?? null,
          source: "db",
        },
      ];
    }
    // DB 没有 → 远端实时报价兜底（覆盖未入库的代码）
    const q = await fetchTencentQuote(exactCode).catch(() => null);
    if (q) {
      return [
        {
          tsCode: exactCode,
          name: q.name || exactCode,
          board: inferBoard(exactCode.slice(0, 6)),
          industry: null,
          source: "remote",
        },
      ];
    }
    return [];
  }

  // 2) 数字开头（不是完整 6 位）→ 当作代码前缀查
  if (/^\d+$/.test(raw)) {
    const list = await prisma.stock.findMany({
      where: { symbol: { startsWith: raw } },
      take: limit,
      orderBy: { symbol: "asc" },
    });
    return list.map(
      (s): StockCandidate => ({
        tsCode: s.tsCode,
        name: s.name,
        board: s.board ?? null,
        industry: s.industry ?? null,
        source: "db",
      })
    );
  }

  // 3) 中文/英文 → 名称模糊
  const list = await prisma.stock.findMany({
    where: { name: { contains: raw } },
    take: limit,
    orderBy: { tsCode: "asc" },
  });
  return list.map(
    (s): StockCandidate => ({
      tsCode: s.tsCode,
      name: s.name,
      board: s.board ?? null,
      industry: s.industry ?? null,
      source: "db",
    })
  );
}

// 让市场推断在前端 board 缺失时也能补
export { inferMarket };

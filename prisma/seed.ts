/**
 * 初始化数据库：写入内置股票池 + 内置策略预设
 * 运行：npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import { BUILTIN_POOL, inferBoard } from "../lib/data/universe";
import { BUILTIN_STRATEGIES } from "../lib/screener/presets";

const prisma = new PrismaClient();

async function main() {
  console.log(`[seed] 写入 ${BUILTIN_POOL.length} 只内置股票...`);
  for (const s of BUILTIN_POOL) {
    const board = inferBoard(s.symbol);
    await prisma.stock.upsert({
      where: { tsCode: s.tsCode },
      update: {
        name: s.name,
        industry: s.industry,
        market: s.market,
        symbol: s.symbol,
        board,
      },
      create: {
        tsCode: s.tsCode,
        symbol: s.symbol,
        name: s.name,
        industry: s.industry,
        market: s.market,
        board,
      },
    });
  }

  console.log(`[seed] 写入 ${BUILTIN_STRATEGIES.length} 个内置策略...`);
  for (const st of BUILTIN_STRATEGIES) {
    await prisma.strategy.upsert({
      where: { name: st.name },
      update: {
        description: st.description,
        ruleConfig: JSON.stringify(st.ruleConfig),
      },
      create: {
        name: st.name,
        description: st.description,
        ruleConfig: JSON.stringify(st.ruleConfig),
      },
    });
  }

  console.log("[seed] 完成。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

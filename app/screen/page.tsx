import { prisma } from "@/lib/db/prisma";
import { BUILTIN_POOL } from "@/lib/data/universe";
import { getBuiltinByName } from "@/lib/screener/presets";
import ScanForm from "./scan-form";

export const dynamic = "force-dynamic";
// 全 A 股扫描可能超过 60 秒，Vercel Pro 上允许至 300 秒
export const maxDuration = 300;

export default async function ScreenPage() {
  const strategies = await prisma.strategy.findMany({
    orderBy: { createdAt: "asc" },
  });
  const totalStockCount = await prisma.stock.count();
  const builtinSet = new Set(BUILTIN_POOL.map((s) => s.tsCode));
  const builtinCount = await prisma.stock.count({
    where: { tsCode: { in: Array.from(builtinSet) } },
  });
  const watchlistCount = await prisma.watchlist.count();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">右侧买点扫描</h1>
        <p className="text-sm text-ink-soft mt-1">
          选择股票池与策略，点击「开始扫描」即可。命中规则越多，评分越高。
        </p>
      </div>
      <ScanForm
        strategies={strategies.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          ruleConfig: s.ruleConfig,
          // 把内置策略的操盘手册以纯数据形式带给客户端
          playbook: getBuiltinByName(s.name)?.playbook ?? null,
        }))}
        builtinCount={builtinCount}
        totalStockCount={totalStockCount}
        watchlistCount={watchlistCount}
      />
    </div>
  );
}

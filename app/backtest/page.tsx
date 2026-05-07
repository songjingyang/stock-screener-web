import { prisma } from "@/lib/db/prisma";
import BacktestForm from "./backtest-form";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function BacktestPage() {
  const strategies = await prisma.strategy.findMany({
    orderBy: { createdAt: "asc" },
  });
  const stockCount = await prisma.stock.count();
  const watchlistCount = await prisma.watchlist.count();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">策略回测</h1>
        <p className="text-sm text-ink-soft mt-1">
          在历史区间内对所选策略进行回测，评估胜率与收益。模型简化：信号次日开盘买入，持有 N
          个交易日后按收盘卖出，不考虑滑点和手续费。
        </p>
      </div>
      <BacktestForm
        strategies={strategies.map((s) => ({ id: s.id, name: s.name }))}
        stockCount={stockCount}
        watchlistCount={watchlistCount}
      />
    </div>
  );
}

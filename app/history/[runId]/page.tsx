import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { compactDate, formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/app/screen/sparkline";

export const dynamic = "force-dynamic";

interface Props {
  params: { runId: string };
}

export default async function HistoryDetailPage({ params }: Props) {
  const run = await prisma.scanRun.findUnique({
    where: { id: params.runId },
    include: {
      strategy: true,
      results: {
        orderBy: [{ pass: "desc" }, { score: "desc" }],
      },
    },
  });
  if (!run) notFound();

  const tsCodes = run.results.map((r) => r.tsCode);
  const stocks = await prisma.stock.findMany({
    where: { tsCode: { in: tsCodes } },
  });
  const stockMap = new Map(stocks.map((s) => [s.tsCode, s]));

  // 取每只股票截止扫描日的最近 30 个交易日收盘价（用于迷你走势图）
  const klineRows = await prisma.klineDaily.findMany({
    where: {
      tsCode: { in: tsCodes },
      tradeDate: { lte: run.scanDate },
    },
    orderBy: [{ tsCode: "asc" }, { tradeDate: "desc" }],
    select: { tsCode: true, tradeDate: true, close: true },
  });
  const closesMap = new Map<string, number[]>();
  for (const row of klineRows) {
    const arr = closesMap.get(row.tsCode);
    if (!arr) {
      closesMap.set(row.tsCode, [row.close]);
    } else if (arr.length < 30) {
      arr.push(row.close);
    }
  }
  // 上面是按降序填的，需要反转回升序方便画图
  for (const [k, v] of closesMap) closesMap.set(k, v.reverse());

  return (
    <div className="space-y-4">
      <div>
        <Link href="/history" className="text-sm text-ink-soft hover:text-ink">
          ← 历史列表
        </Link>
      </div>
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">
            {run.strategy.name}
          </h1>
          <p className="text-sm text-ink-soft mt-1">
            扫描日 {compactDate(run.scanDate)} · 命中{" "}
            <b className="text-bull">{run.hitCount}</b> / {run.totalCount}
          </p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto table-scroll">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="text-ink-soft text-left">
            <tr className="border-b border-line">
              <th className="py-2 px-4 font-medium">代码</th>
              <th className="py-2 px-4 font-medium">名称</th>
              <th className="py-2 px-4 font-medium">板块</th>
              <th className="py-2 px-4 font-medium">行业</th>
              <th className="py-2 px-4 font-medium">命中</th>
              <th className="py-2 px-4 font-medium">评分</th>
              <th className="py-2 px-4 font-medium">收盘</th>
              <th className="py-2 px-4 font-medium whitespace-nowrap">近 30 日</th>
              <th className="py-2 px-4 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {run.results.map((r) => {
              const detail = JSON.parse(r.detail) as {
                context: { close: number };
              };
              const stock = stockMap.get(r.tsCode);
              return (
                <tr
                  key={r.id}
                  className={cn(
                    "border-b border-line/50 hover:bg-bg-soft/40",
                    r.pass && "bg-bull/5"
                  )}
                >
                  <td className="py-2 px-4 font-mono">{r.tsCode}</td>
                  <td className="py-2 px-4">{stock?.name ?? "—"}</td>
                  <td className="py-2 px-4">
                    {stock?.board ? (
                      <span className="badge bg-bg-soft text-ink-soft border border-line">
                        {stock.board}
                      </span>
                    ) : (
                      <span className="text-ink-mute">—</span>
                    )}
                  </td>
                  <td className="py-2 px-4 text-ink-soft">
                    {stock?.industry ?? "—"}
                  </td>
                  <td className="py-2 px-4">
                    <span
                      className={cn(
                        "badge",
                        r.pass ? "badge-pass" : "bg-bg-soft text-ink-soft"
                      )}
                    >
                      {r.pass ? "命中" : "—"}
                    </span>
                  </td>
                  <td className="py-2 px-4">{r.score}</td>
                  <td className="py-2 px-4 font-mono">
                    {formatNumber(detail.context.close)}
                  </td>
                  <td className="py-2 px-4">
                    {(() => {
                      const closes = closesMap.get(r.tsCode);
                      return closes && closes.length > 1 ? (
                        <Sparkline values={closes} />
                      ) : (
                        <span className="text-ink-mute text-xs">—</span>
                      );
                    })()}
                  </td>
                  <td className="py-2 px-4">
                    <Link
                      href={`/stock/${r.tsCode}?strategy=${run.strategyId}`}
                      className="text-accent text-xs hover:underline"
                    >
                      详情 →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

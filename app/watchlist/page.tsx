import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import RemoveButton from "./remove-button";
import { Sparkline } from "@/app/screen/sparkline";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const items = await prisma.watchlist.findMany({
    orderBy: { createdAt: "desc" },
  });
  const tsCodes = items.map((i) => i.tsCode);

  const stocks = await prisma.stock.findMany({
    where: { tsCode: { in: tsCodes } },
  });
  const map = new Map(stocks.map((s) => [s.tsCode, s]));

  // 取最近 30 个交易日收盘价（缓存里有就显示，没有就 —）
  const klineRows = await prisma.klineDaily.findMany({
    where: { tsCode: { in: tsCodes } },
    orderBy: [{ tsCode: "asc" }, { tradeDate: "desc" }],
    select: { tsCode: true, close: true },
  });
  const closesMap = new Map<string, number[]>();
  for (const row of klineRows) {
    const arr = closesMap.get(row.tsCode);
    if (!arr) closesMap.set(row.tsCode, [row.close]);
    else if (arr.length < 30) arr.push(row.close);
  }
  for (const [k, v] of closesMap) closesMap.set(k, v.reverse());

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">自选股</h1>
        <span className="text-sm text-ink-soft">{items.length} 只</span>
      </div>

      {items.length === 0 ? (
        <div className="card p-8 text-center text-ink-mute">
          自选股为空。在<Link href="/screen" className="text-accent mx-1">筛选</Link>页面中点击命中股票，进入详情后点击「加入自选」。
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto table-scroll">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-ink-soft text-left">
              <tr className="border-b border-line">
                <th className="py-2 px-4 font-medium">代码</th>
                <th className="py-2 px-4 font-medium">名称</th>
                <th className="py-2 px-4 font-medium">板块</th>
                <th className="py-2 px-4 font-medium">行业</th>
                <th className="py-2 px-4 font-medium whitespace-nowrap">近 30 日</th>
                <th className="py-2 px-4 font-medium">添加时间</th>
                <th className="py-2 px-4 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const s = map.get(it.tsCode);
                return (
                  <tr key={it.id} className="border-b border-line/50 hover:bg-bg-muted">
                    <td className="py-2 px-4 font-mono">
                      <Link
                        href={`/stock/${it.tsCode}`}
                        className="text-accent hover:underline"
                      >
                        {it.tsCode}
                      </Link>
                    </td>
                    <td className="py-2 px-4">{s?.name ?? "—"}</td>
                    <td className="py-2 px-4">
                      {s?.board ? (
                        <span className="badge bg-bg-soft text-ink-soft border border-line">
                          {s.board}
                        </span>
                      ) : (
                        <span className="text-ink-mute">—</span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-ink-soft">
                      {s?.industry ?? "—"}
                    </td>
                    <td className="py-2 px-4">
                      {(() => {
                        const closes = closesMap.get(it.tsCode);
                        return closes && closes.length > 1 ? (
                          <Sparkline values={closes} />
                        ) : (
                          <span className="text-ink-mute text-xs">—</span>
                        );
                      })()}
                    </td>
                    <td className="py-2 px-4 text-ink-soft font-mono">
                      {it.createdAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="py-2 px-4">
                      <RemoveButton tsCode={it.tsCode} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

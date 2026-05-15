import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { compactDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const runs = await prisma.scanRun.findMany({
    orderBy: { createdAt: "desc" },
    include: { strategy: true },
    take: 50,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">历史扫描</h1>
      {runs.length === 0 ? (
        <div className="card p-8 text-center text-ink-mute">
          暂无历史。前往
          <Link href="/screen" className="text-accent mx-1">
            筛选
          </Link>
          页面执行扫描并勾选「将本次扫描结果存入历史」。
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto table-scroll">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="text-ink-soft text-left">
                <tr className="border-b border-line">
                  <th className="py-2 px-3 sm:px-4 font-medium">扫描日</th>
                  <th className="py-2 px-3 sm:px-4 font-medium">策略</th>
                  <th className="py-2 px-3 sm:px-4 font-medium">命中</th>
                  <th className="py-2 px-3 sm:px-4 font-medium">总数</th>
                  <th className="py-2 px-3 sm:px-4 font-medium">时间</th>
                  <th className="py-2 px-3 sm:px-4 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-line/50 hover:bg-bg-muted"
                  >
                    <td className="py-2 px-3 sm:px-4 font-mono whitespace-nowrap">
                      {compactDate(r.scanDate)}
                    </td>
                    <td className="py-2 px-3 sm:px-4 whitespace-nowrap">
                      {r.strategy.name}
                    </td>
                    <td className="py-2 px-3 sm:px-4 text-bull">{r.hitCount}</td>
                    <td className="py-2 px-3 sm:px-4 text-ink-soft">
                      {r.totalCount}
                    </td>
                    <td className="py-2 px-3 sm:px-4 text-ink-soft text-xs whitespace-nowrap">
                      {r.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="py-2 px-3 sm:px-4 whitespace-nowrap">
                      <Link
                        href={`/history/${r.id}`}
                        className="text-accent text-xs hover:underline"
                      >
                        查看 →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

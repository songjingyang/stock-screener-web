import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { Sparkline } from "@/app/screen/sparkline";
import {
  compactDate,
  formatNumber,
  formatPercent,
  cn,
} from "@/lib/utils";
import { BUILTIN_STRATEGIES } from "@/lib/screener/presets";
import MorningTrigger from "./morning-trigger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 早间开盘扫描结果页：每天 09:25 cron 自动跑 + 手动重跑按钮
 *
 * 数据流：
 *   - ScanRun 历史里筛 strategyName == "全指标共振（高胜率）" 的最近一条
 *   - 命中股票排前，按 score 倒序
 *   - 顶部 Top 5 用大卡片展示买/止损/止盈参考价
 */
export default async function MorningPage() {
  const playbook = BUILTIN_STRATEGIES.find(
    (s) => s.name === "全指标共振（高胜率）"
  )?.playbook;

  // 最近一次 morning-scan（按策略名匹配）
  const lastRun = await prisma.scanRun.findFirst({
    where: { strategy: { name: "全指标共振（高胜率）" } },
    orderBy: { createdAt: "desc" },
    include: {
      strategy: true,
      results: { orderBy: [{ pass: "desc" }, { score: "desc" }] },
    },
  });

  const hits = lastRun?.results.filter((r) => r.pass) ?? [];
  const top5 = hits.slice(0, 5);

  // 补 stock 元信息 + 30 日 sparkline 收盘
  const tsCodes = hits.map((r) => r.tsCode);
  const stocks = tsCodes.length
    ? await prisma.stock.findMany({ where: { tsCode: { in: tsCodes } } })
    : [];
  const stockMap = new Map(stocks.map((s) => [s.tsCode, s]));

  const kRows = tsCodes.length
    ? await prisma.klineDaily.findMany({
        where: { tsCode: { in: tsCodes } },
        orderBy: [{ tsCode: "asc" }, { tradeDate: "desc" }],
        select: { tsCode: true, tradeDate: true, close: true },
      })
    : [];
  const closesMap = new Map<string, number[]>();
  for (const row of kRows) {
    const arr = closesMap.get(row.tsCode);
    if (!arr) closesMap.set(row.tsCode, [row.close]);
    else if (arr.length < 30) arr.push(row.close);
  }
  for (const [k, v] of closesMap) closesMap.set(k, v.reverse());

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <span>🌅 开盘前推荐</span>
          </h1>
          <p className="text-sm text-ink-soft mt-1">
            每个交易日 <b className="text-ink">09:25</b> 集合竞价时段自动运行 ·
            策略：<b className="text-ink">全指标共振（高胜率）</b> · 用实时集合竞价价驱动指标
          </p>
        </div>
        <MorningTrigger />
      </div>

      {/* 上次扫描元信息 */}
      <div className="card p-3 sm:p-4 text-sm flex items-center gap-2 sm:gap-4 flex-wrap">
        {lastRun ? (
          <>
            <span>
              📅 最近一次：
              <b className="font-mono ml-1">{compactDate(lastRun.scanDate)}</b>
            </span>
            <span className="text-line">·</span>
            <span>
              命中 <b className="text-bull">{lastRun.hitCount}</b> 只
            </span>
            <span className="text-line">·</span>
            <span className="text-ink-soft">
              共扫描 {lastRun.totalCount} 只
            </span>
            <span className="text-line">·</span>
            <span className="text-ink-mute text-xs">
              更新于{" "}
              {lastRun.createdAt
                .toISOString()
                .slice(0, 16)
                .replace("T", " ")}
            </span>
          </>
        ) : (
          <span className="text-ink-mute">
            暂无扫描记录。点击右上角按钮立即跑一次。
          </span>
        )}
      </div>

      {/* Top 5 推荐大卡 */}
      {top5.length > 0 && (
        <section className="card overflow-hidden border-amber-400 bg-amber-50">
          <div className="px-3 sm:px-4 py-2 border-b border-amber-300 text-sm font-medium flex items-center gap-2 flex-wrap">
            <span className="text-amber-600">
              ⭐ Top {top5.length} 开盘推荐
            </span>
            <span className="text-ink-mute text-xs hidden sm:inline">
              按高胜率策略评分 + 命中条件数排序
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-3">
            {top5.map((r, idx) => {
              const stock = stockMap.get(r.tsCode);
              const closes = closesMap.get(r.tsCode) ?? [];
              const close = parseCloseFromDetail(r.detail);
              const trade = computeTradePlan(close);
              return (
                <div
                  key={r.id}
                  className="rounded-lg border border-amber-300 bg-bg-muted p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-amber-600 font-semibold">
                        #{idx + 1}
                      </span>
                      <Link
                        href={`/stock/${encodeURIComponent(r.tsCode)}`}
                        className="font-mono text-base text-accent hover:underline"
                      >
                        {r.tsCode}
                      </Link>
                      <span className="text-ink">{stock?.name ?? "—"}</span>
                      {stock?.board && (
                        <span className="badge bg-bg-soft text-ink-soft border border-line text-[10px]">
                          {stock.board}
                        </span>
                      )}
                      {stock?.industry && (
                        <span className="badge bg-accent/10 text-accent border border-accent/30 text-[10px]">
                          {stock.industry}
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-semibold text-amber-600 leading-none">
                        {r.score}
                      </div>
                      <div className="text-xs text-ink-mute">评分</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-ink-soft">
                      现价{" "}
                      <span className="font-mono text-ink">
                        {formatNumber(close)}
                      </span>
                    </div>
                    {closes.length > 1 && (
                      <Sparkline values={closes} width={140} height={36} />
                    )}
                  </div>

                  {trade && (
                    <div className="grid grid-cols-3 gap-2 text-xs pt-1">
                      <div className="rounded border border-bull/30 bg-bull/10 px-2 py-1.5">
                        <div className="text-ink-mute text-[10px] mb-0.5">
                          买点
                        </div>
                        <div className="font-mono text-bull font-semibold">
                          ≤ {formatNumber(trade.entryMax)}
                        </div>
                      </div>
                      <div className="rounded border border-bear/30 bg-bear/10 px-2 py-1.5">
                        <div className="text-ink-mute text-[10px] mb-0.5">
                          止损
                        </div>
                        <div className="font-mono text-bear font-semibold">
                          {formatNumber(trade.stopLoss)}
                        </div>
                      </div>
                      <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5">
                        <div className="text-ink-mute text-[10px] mb-0.5">
                          分批卖
                        </div>
                        <div className="font-mono text-amber-600 font-semibold">
                          {formatNumber(trade.tp1)}
                          <span className="text-ink-mute"> / </span>
                          {formatNumber(trade.tp2)}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 完整命中列表 */}
      {hits.length > top5.length && (
        <section className="card overflow-hidden">
          <div className="px-3 sm:px-4 py-2 border-b border-line text-sm font-medium">
            其余命中（{hits.length - top5.length}）
          </div>
          <div className="overflow-x-auto table-scroll">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="text-ink-soft text-left">
                <tr className="border-b border-line">
                  <th className="py-2 px-3 sm:px-4 font-medium">代码</th>
                  <th className="py-2 px-4 font-medium">名称</th>
                  <th className="py-2 px-4 font-medium">板块</th>
                  <th className="py-2 px-4 font-medium">行业</th>
                  <th className="py-2 px-4 font-medium text-right">评分</th>
                  <th className="py-2 px-4 font-medium text-right">现价</th>
                  <th className="py-2 px-4 font-medium text-right">买点</th>
                  <th className="py-2 px-4 font-medium text-right">止损</th>
                  <th className="py-2 px-4 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {hits.slice(top5.length).map((r) => {
                  const stock = stockMap.get(r.tsCode);
                  const close = parseCloseFromDetail(r.detail);
                  const trade = computeTradePlan(close);
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-line/50 hover:bg-bg-muted bg-bull/10"
                    >
                      <td className="py-2 px-3 sm:px-4 font-mono">
                        {r.tsCode}
                      </td>
                      <td className="py-2 px-4">{stock?.name ?? "—"}</td>
                      <td className="py-2 px-4">
                        {stock?.board ? (
                          <span className="badge bg-bg-soft text-ink-soft border border-line text-[10px]">
                            {stock.board}
                          </span>
                        ) : (
                          <span className="text-ink-mute">—</span>
                        )}
                      </td>
                      <td className="py-2 px-4 text-ink-soft">
                        {stock?.industry ?? "—"}
                      </td>
                      <td className="py-2 px-4 text-right font-mono">
                        {r.score}
                      </td>
                      <td className="py-2 px-4 text-right font-mono">
                        {formatNumber(close)}
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-bull">
                        {trade ? `≤${formatNumber(trade.entryMax)}` : "—"}
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-bear">
                        {trade ? formatNumber(trade.stopLoss) : "—"}
                      </td>
                      <td className="py-2 px-4">
                        <Link
                          href={`/stock/${encodeURIComponent(r.tsCode)}`}
                          className="text-accent hover:underline text-xs"
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
        </section>
      )}

      {hits.length === 0 && lastRun && (
        <div className="card p-6 text-center text-ink-mute text-sm">
          本次扫描未命中任何「{lastRun.strategy.name}」。试试盘中重跑，
          或在 <Link href="/screen" className="text-accent">筛选页</Link>{" "}
          换其他策略。
        </div>
      )}

      {/* 操盘纪律提示 */}
      {playbook && (
        <section className="card overflow-hidden border-accent/30">
          <div className="px-3 sm:px-4 py-2 border-b border-accent/30 bg-accent-mute text-sm font-medium">
            📋 操盘纪律 · 全指标共振（高胜率）
          </div>
          <div className="p-3 sm:p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="rounded border border-bull/30 bg-bull/10 p-2.5">
              <div className="font-medium text-bull mb-1">🟢 买入</div>
              <p className="text-ink-soft leading-relaxed">{playbook.entry}</p>
            </div>
            <div className="rounded border border-bear/30 bg-bear/10 p-2.5">
              <div className="font-medium text-bear mb-1">🔴 止损</div>
              <p className="text-ink-soft leading-relaxed">
                {playbook.stopLoss}
              </p>
            </div>
            <div className="rounded border border-amber-300 bg-amber-50 p-2.5">
              <div className="font-medium text-amber-600 mb-1">🟡 卖出</div>
              <p className="text-ink-soft leading-relaxed">{playbook.exit}</p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function parseCloseFromDetail(detail: string): number {
  try {
    const d = JSON.parse(detail) as { context?: { close?: number } };
    return d?.context?.close ?? 0;
  } catch {
    return 0;
  }
}

/** 与 scan-form / stock 页保持一致的「全指标共振」止损止盈系数 */
function computeTradePlan(close: number) {
  if (!Number.isFinite(close) || close <= 0) return null;
  return {
    entryMax: close * 1.01,
    stopLoss: close * 0.95,
    tp1: close * 1.1,
    tp2: close * 1.2,
  };
}

import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { getKline, isMarketOpen } from "@/lib/data/kline-cache";
import { evaluate } from "@/lib/screener/rule-engine";
import type { RuleConfig } from "@/lib/screener/rule-engine";
import { compactDate, formatNumber, formatPercent, cn } from "@/lib/utils";
import { sma } from "@/lib/indicators";
import {
  fetchAnnouncements,
  levelLabel,
  type Announcement,
} from "@/lib/data/announcements";
import {
  BUILTIN_STRATEGIES,
  type StrategyPlaybook,
} from "@/lib/screener/presets";
import KLineChart from "./kline-chart";
import WatchlistButton from "./watchlist-button";
import StrategySelect from "./strategy-select";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { tsCode: string };
  searchParams: { strategy?: string };
}

export default async function StockPage({ params, searchParams }: PageProps) {
  const tsCode = decodeURIComponent(params.tsCode);
  const stock = await prisma.stock.findUnique({ where: { tsCode } });
  if (!stock) {
    // 允许访问未入库的股票（动态查 Tushare），这里仅提示一下
  }

  let kline: Awaited<ReturnType<typeof getKline>> = [];
  let kerror: string | null = null;
  try {
    // 分析单股：默认走缓存（凌晨 warmup 已填好）+ 盘中合并实时分时价
    // 之前 forceRefresh:true 让每次访问都打腾讯日 K 接口，单股页打开变成 1-3s 延迟
    kline = await getKline(tsCode, {
      lookbackDays: 400,
      mergeRealtime: true,
    });
  } catch (err) {
    kerror = (err as Error).message;
  }
  const marketOpen = isMarketOpen();

  // 公告 / 重大事项（与 K 线并行抓取，失败不影响整页）
  const announcements = await fetchAnnouncements(tsCode, { limit: 12 });

  const strategies = await prisma.strategy.findMany({
    orderBy: { createdAt: "asc" },
  });
  const strategyId = searchParams.strategy ?? strategies[0]?.id ?? null;
  const strategy = strategyId
    ? strategies.find((s) => s.id === strategyId)
    : null;

  const inWatchlist = await prisma.watchlist
    .findUnique({ where: { tsCode } })
    .then((w) => !!w);

  const evalResult =
    kline.length >= 70 && strategy
      ? evaluate(kline, JSON.parse(strategy.ruleConfig) as RuleConfig)
      : null;

  // 多策略并行评估（仅对内置 4 个策略）：让用户一眼看到本股票今日命中了哪些策略
  const lastClose = kline.length ? kline[kline.length - 1].close : 0;
  const multiAnalysis =
    kline.length >= 70
      ? BUILTIN_STRATEGIES.map((bs) => {
          const r = evaluate(kline, bs.ruleConfig);
          return r ? { name: bs.name, playbook: bs.playbook, result: r } : null;
        }).filter((x): x is NonNullable<typeof x> => x !== null)
      : [];

  // MA 序列（用于图表）
  const closes = kline.map((k) => k.close);
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-semibold font-mono">{tsCode}</h1>
            <span className="text-ink-soft">{stock?.name ?? "—"}</span>
            {stock?.board && (
              <span className="badge bg-bg-soft text-ink-soft border border-line">
                {stock.board}
              </span>
            )}
            {stock?.industry && (
              <span className="badge bg-accent/10 text-accent border border-accent/30">
                {stock.industry}
              </span>
            )}
          </div>
          {kline.length > 0 && (
            <div className="text-sm text-ink-mute mt-1 flex items-center gap-2 flex-wrap">
              <span>
                最新 {compactDate(kline[kline.length - 1].date)} ·{" "}
                {marketOpen ? "分时实时价" : "收盘"}{" "}
                <span
                  className={cn(
                    "font-mono",
                    marketOpen ? "text-amber-400 font-semibold" : "text-ink"
                  )}
                >
                  {formatNumber(kline[kline.length - 1].close)}
                </span>
              </span>
              {marketOpen && (
                <span className="badge bg-amber-500/15 text-amber-400 border border-amber-500/40 text-[10px]">
                  ● 盘中实时
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <WatchlistButton tsCode={tsCode} initialIn={inWatchlist} />
          <Link href="/screen" className="btn">
            返回筛选
          </Link>
        </div>
      </div>

      {kerror && (
        <div className="card p-3 text-sm text-bear border-bear/40">
          数据加载失败：{kerror}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="card p-2">
          {kline.length ? (
            <KLineChart
              kline={kline.map((k) => ({
                time: `${k.date.slice(0, 4)}-${k.date.slice(4, 6)}-${k.date.slice(6, 8)}`,
                open: k.open,
                high: k.high,
                low: k.low,
                close: k.close,
                volume: k.vol,
              }))}
              ma5={kline.map((k, i) => ({
                time: `${k.date.slice(0, 4)}-${k.date.slice(4, 6)}-${k.date.slice(6, 8)}`,
                value: ma5[i] as number | null,
              }))}
              ma10={kline.map((k, i) => ({
                time: `${k.date.slice(0, 4)}-${k.date.slice(4, 6)}-${k.date.slice(6, 8)}`,
                value: ma10[i] as number | null,
              }))}
              ma20={kline.map((k, i) => ({
                time: `${k.date.slice(0, 4)}-${k.date.slice(4, 6)}-${k.date.slice(6, 8)}`,
                value: ma20[i] as number | null,
              }))}
              ma60={kline.map((k, i) => ({
                time: `${k.date.slice(0, 4)}-${k.date.slice(4, 6)}-${k.date.slice(6, 8)}`,
                value: ma60[i] as number | null,
              }))}
            />
          ) : (
            <div className="h-[300px] sm:h-[480px] flex items-center justify-center text-ink-mute">
              无 K 线数据
            </div>
          )}
        </div>

        <aside className="card p-4 space-y-4">
          <div>
            <div className="text-sm text-ink-soft mb-2">策略评估</div>
            <StrategySelect
              currentId={strategyId ?? ""}
              strategies={strategies.map((s) => ({ id: s.id, name: s.name }))}
            />
          </div>

          {evalResult ? (
            <>
              <div className="flex items-baseline gap-3">
                <span
                  className={
                    evalResult.pass
                      ? "badge badge-pass text-base px-2 py-1"
                      : "badge bg-bg-soft text-ink-soft text-base px-2 py-1"
                  }
                >
                  {evalResult.pass ? "命中" : "未命中"}
                </span>
                <span className="text-sm">
                  评分 {evalResult.score}/{evalResult.maxScore}
                </span>
              </div>

              <ul className="space-y-1.5 text-sm">
                {evalResult.conditions.map((c, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span
                      className={
                        c.pass ? "text-bull" : "text-ink-mute"
                      }
                    >
                      {c.pass ? "✓" : "✗"}
                    </span>
                    <span className={c.pass ? "" : "text-ink-soft"}>{c.label}</span>
                  </li>
                ))}
              </ul>

              <div className="border-t border-line pt-3 space-y-1 text-xs text-ink-soft">
                <KV label="MA5">{formatNumber(evalResult.context.ma.MA5)}</KV>
                <KV label="MA10">{formatNumber(evalResult.context.ma.MA10)}</KV>
                <KV label="MA20">{formatNumber(evalResult.context.ma.MA20)}</KV>
                <KV label="MA60">{formatNumber(evalResult.context.ma.MA60)}</KV>
                <KV label="DIF">{formatNumber(evalResult.context.macd.dif, 3)}</KV>
                <KV label="DEA">{formatNumber(evalResult.context.macd.dea, 3)}</KV>
                <KV label="RSI14">{formatNumber(evalResult.context.rsi14, 1)}</KV>
                <KV label="K/D/J">
                  {formatNumber(evalResult.context.kdj.k, 1)} /{" "}
                  {formatNumber(evalResult.context.kdj.d, 1)} /{" "}
                  {formatNumber(evalResult.context.kdj.j, 1)}
                </KV>
                <KV label="量比">{formatNumber(evalResult.context.volRatio)}</KV>
                <KV label="ATR/价">
                  {formatPercent(evalResult.context.atrPct)}
                </KV>
              </div>
            </>
          ) : (
            <div className="text-sm text-ink-mute">
              数据不足或未选择策略。
            </div>
          )}
        </aside>
      </div>

      {multiAnalysis.length > 0 && (
        <MultiStrategyAnalysis
          analyses={multiAnalysis}
          close={lastClose}
        />
      )}

      <AnnouncementsSection announcements={announcements} />
    </div>
  );
}

/**
 * 多策略命中分析卡：4 个内置策略并行跑一遍，每行显示
 *   命中状态 / 评分 / 当前策略对应的买卖参考价
 */
function MultiStrategyAnalysis({
  analyses,
  close,
}: {
  analyses: Array<{
    name: string;
    playbook: StrategyPlaybook;
    result: NonNullable<ReturnType<typeof evaluate>>;
  }>;
  close: number;
}) {
  const hits = analyses.filter((a) => a.result.pass);
  return (
    <section className="card overflow-hidden">
      <div className="px-3 sm:px-4 py-2 border-b border-line flex items-center gap-2 flex-wrap">
        <span className="text-base font-semibold">📊 多策略命中分析</span>
        {hits.length > 0 ? (
          <span className="badge badge-pass text-xs">
            命中 {hits.length}/{analyses.length}
          </span>
        ) : (
          <span className="badge bg-bg-soft text-ink-soft text-xs">
            未命中任何策略
          </span>
        )}
        <span className="text-xs text-ink-mute hidden sm:inline">
          按当前收盘价 {formatNumber(close)} 计算买卖参考价
        </span>
      </div>
      <div className="divide-y divide-line/50">
        {analyses.map((a) => {
          const trade = computeTradePlan(close, a.name);
          return (
            <div
              key={a.name}
              className={cn(
                "p-3 sm:p-4 space-y-2",
                a.result.pass && "bg-bull/5"
              )}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={cn(
                    "badge text-xs",
                    a.result.pass
                      ? "badge-pass"
                      : "bg-bg-soft text-ink-soft"
                  )}
                >
                  {a.result.pass ? "✓ 命中" : "✗ 未命中"}
                </span>
                <span className="font-medium">{a.name}</span>
                <span className="badge bg-accent/10 text-accent border border-accent/30 text-xs">
                  {a.playbook.tag}
                </span>
                <span className="text-xs text-ink-soft">
                  评分 {a.result.score}/{a.result.maxScore}
                </span>
                <span className="text-xs text-ink-mute hidden md:inline">
                  · 持有 {a.playbook.holdPeriod} · {a.playbook.position}
                </span>
              </div>

              {/* 条件命中徽标 */}
              <div className="flex flex-wrap gap-1">
                {a.result.conditions.map((c, i) => (
                  <span
                    key={i}
                    className={cn(
                      "badge text-[10px]",
                      c.pass
                        ? "badge-pass"
                        : "bg-bg-soft text-ink-mute border border-line"
                    )}
                    title={c.label}
                  >
                    {c.label}
                  </span>
                ))}
              </div>

              {/* 仅对命中的策略显示具体买卖参考价 */}
              {a.result.pass && trade && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs pt-1">
                  <div className="rounded border border-bull/30 bg-bull/5 px-2.5 py-2">
                    <div className="text-ink-mute text-[10px] mb-0.5">
                      🟢 买入
                    </div>
                    <div className="font-mono text-bull font-semibold">
                      ≤ {formatNumber(trade.entryMax)}
                    </div>
                    <div className="text-ink-soft text-[11px] mt-1">
                      {a.playbook.entry}
                    </div>
                  </div>
                  <div className="rounded border border-bear/30 bg-bear/5 px-2.5 py-2">
                    <div className="text-ink-mute text-[10px] mb-0.5">
                      🔴 止损
                    </div>
                    <div className="font-mono text-bear font-semibold">
                      {formatNumber(trade.stopLoss)}
                    </div>
                    <div className="text-ink-soft text-[11px] mt-1">
                      {a.playbook.stopLoss}
                    </div>
                  </div>
                  <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
                    <div className="text-ink-mute text-[10px] mb-0.5">
                      🟡 分批卖
                    </div>
                    <div className="font-mono text-amber-400 font-semibold">
                      {formatNumber(trade.takeProfit1)}
                      <span className="text-ink-mute"> / </span>
                      {formatNumber(trade.takeProfit2)}
                    </div>
                    <div className="text-ink-soft text-[11px] mt-1">
                      {a.playbook.exit}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="px-3 sm:px-4 py-2 border-t border-line text-[11px] text-ink-mute leading-relaxed">
        命中即代表当日所有规则同时满足；未命中策略可参考上方未通过的条件徽标，了解还差几条。
        买卖参考价基于当前收盘价 × 各策略止损/止盈系数，请配合 K 线均线位置微调。
      </div>
    </section>
  );
}

/**
 * 同 scan-form 内的策略买卖价计算（保持口径一致）
 */
function computeTradePlan(close: number, strategyName: string) {
  if (!Number.isFinite(close) || close <= 0) return null;
  switch (strategyName) {
    case "三指标共振":
      return {
        entryMax: close * 1.01,
        stopLoss: close * 0.93,
        takeProfit1: close * 1.08,
        takeProfit2: close * 1.15,
      };
    case "强势缩量回踩":
      return {
        entryMax: close * 1.005,
        stopLoss: close * 0.97,
        takeProfit1: close * 1.06,
        takeProfit2: close * 1.12,
      };
    case "平台突破":
      return {
        entryMax: close * 1.01,
        stopLoss: close * 0.95,
        takeProfit1: close * 1.15,
        takeProfit2: close * 1.30,
      };
    case "全指标共振（高胜率）":
      return {
        entryMax: close * 1.01,
        stopLoss: close * 0.95,
        takeProfit1: close * 1.10,
        takeProfit2: close * 1.20,
      };
    default:
      return {
        entryMax: close * 1.01,
        stopLoss: close * 0.93,
        takeProfit1: close * 1.08,
        takeProfit2: close * 1.15,
      };
  }
}

function AnnouncementsSection({
  announcements,
}: {
  announcements: Announcement[];
}) {
  if (!announcements.length) {
    return (
      <section className="card p-4">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <span>📢</span>
          <span>重大事项 / 公告</span>
        </h2>
        <div className="text-sm text-ink-mute mt-3">暂未取到公告数据。</div>
      </section>
    );
  }

  const high = announcements.filter((a) => a.level === "high");
  const med = announcements.filter((a) => a.level === "med");

  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <span>📢</span>
          <span>重大事项 / 公告</span>
          <span className="text-xs text-ink-mute font-normal">
            最近 {announcements.length} 条 · 数据来源：东方财富
          </span>
        </h2>
        {(high.length > 0 || med.length > 0) && (
          <div className="text-xs text-ink-soft">
            {high.length > 0 && (
              <span className="text-bear mr-2">重要 {high.length}</span>
            )}
            {med.length > 0 && (
              <span className="text-amber-400">关注 {med.length}</span>
            )}
          </div>
        )}
      </div>
      <ul className="divide-y divide-line/50">
        {announcements.map((a) => (
          <AnnouncementRow key={a.artCode} ann={a} />
        ))}
      </ul>
    </section>
  );
}

function AnnouncementRow({ ann }: { ann: Announcement }) {
  const tone =
    ann.level === "high"
      ? "border-bear/60 bg-bear/15 text-bear"
      : ann.level === "med"
        ? "border-amber-500/60 bg-amber-500/15 text-amber-400"
        : "border-line bg-bg-soft/50 text-ink-mute";
  return (
    <li className="py-2 flex items-start gap-3 group">
      <span
        className={cn(
          "shrink-0 mt-0.5 text-xs px-1.5 py-0.5 rounded border font-medium",
          tone
        )}
      >
        {levelLabel(ann.level)}
      </span>
      <div className="flex-1 min-w-0">
        <a
          href={ann.url}
          target="_blank"
          rel="noreferrer noopener"
          className={cn(
            "text-sm hover:underline",
            ann.level === "high" && "text-bear",
            ann.level === "med" && "text-ink",
            ann.level === "low" && "text-ink-soft"
          )}
        >
          {ann.title}
        </a>
        <div className="flex items-center gap-2 mt-1 text-xs text-ink-mute">
          <span className="font-mono">{ann.noticeDate.slice(0, 10)}</span>
          {ann.columns.length > 0 && (
            <>
              <span className="text-line">·</span>
              <span className="truncate">{ann.columns.join(" / ")}</span>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between font-mono">
      <span className="text-ink-mute">{label}</span>
      <span className="text-ink">{children}</span>
    </div>
  );
}

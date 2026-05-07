import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { compactDate, cn } from "@/lib/utils";
import { getFuturesSettlementDates } from "@/lib/data/futures-settlement";
import {
  fetchCffexPositions,
  netSentiment,
  type ProductSnapshot,
  type ContractPositions,
} from "@/lib/data/cffex-positions";
import {
  fetchLhbHotList,
  formatMoneyCN,
  shortReason,
  type LhbHotSnapshot,
  type LhbHotItem,
} from "@/lib/data/lhb-positions";

/**
 * 首页：展示最近一次扫描的命中情况
 */
export const dynamic = "force-dynamic";

async function getLatestRun() {
  return prisma.scanRun.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      strategy: true,
      results: {
        where: { pass: true },
        orderBy: { score: "desc" },
        take: 30,
      },
    },
  });
}

export default async function HomePage() {
  const latest = await getLatestRun();
  const strategyCount = await prisma.strategy.count();
  const stockCount = await prisma.stock.count();
  const settlementEvents = getFuturesSettlementDates(6).slice(0, 6);

  // 主力多空持仓（机构 = 股指 IF；央妈 = 国债 T）+ 游资热榜（龙虎榜）
  // 三路并行抓取，任意失败均独立降级，不影响其他板块渲染
  const [stockIdxSnap, treasurySnap, lhbSnap] = await Promise.all([
    fetchCffexPositions("IF"),
    fetchCffexPositions("T"),
    fetchLhbHotList({ limit: 10 }),
  ]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <section className="grid grid-cols-3 gap-2 sm:gap-3">
        <StatCard label="内置策略" value={strategyCount} unit="个" />
        <StatCard label="股票池" value={stockCount} unit="只" />
        <StatCard
          label="最近扫描"
          value={latest ? compactDate(latest.scanDate) : "—"}
          unit={latest ? `命中 ${latest.hitCount}` : ""}
        />
      </section>

      <FuturesSettlementCard events={settlementEvents} />

      <PositionsSection
        stockIdx={stockIdxSnap}
        treasury={treasurySnap}
      />

      <LhbHotSection snap={lhbSnap} />

      <section className="card p-4 sm:p-5">
        <div className="flex items-start sm:items-center justify-between mb-3 sm:mb-4 gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h2 className="text-base sm:text-lg font-semibold">今日命中</h2>
            <p className="text-xs sm:text-sm text-ink-soft mt-0.5">
              {latest
                ? `策略：${latest.strategy.name} · 扫描日 ${compactDate(latest.scanDate)} · 命中 ${latest.hitCount}/${latest.totalCount}`
                : "尚未运行扫描，前往 “筛选” 页面执行第一次扫描。"}
            </p>
          </div>
          <Link href="/screen" className="btn btn-primary shrink-0">
            去筛选
          </Link>
        </div>

        {latest && latest.results.length > 0 ? (
          <div className="overflow-x-auto table-scroll -mx-4 sm:mx-0">
            <table className="w-full text-sm min-w-[480px]">
              <thead className="text-ink-soft text-left">
                <tr className="border-b border-line">
                  <th className="py-2 px-3 sm:px-0 font-medium">代码</th>
                  <th className="py-2 font-medium">名称</th>
                  <th className="py-2 font-medium">评分</th>
                  <th className="py-2 font-medium">收盘</th>
                  <th className="py-2 pr-3 sm:pr-0 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {latest.results.map((r) => {
                  const detail = JSON.parse(r.detail) as {
                    context: { close: number };
                  };
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-line/50 hover:bg-bg-soft/40"
                    >
                      <td className="py-2 px-3 sm:px-0 font-mono whitespace-nowrap">
                        {r.tsCode}
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        <Link
                          href={`/stock/${r.tsCode}`}
                          className="text-accent hover:underline"
                        >
                          {r.tsCode}
                        </Link>
                      </td>
                      <td className="py-2">{r.score}</td>
                      <td className="py-2 font-mono">
                        {detail.context.close.toFixed(2)}
                      </td>
                      <td className="py-2 pr-3 sm:pr-0 whitespace-nowrap">
                        <Link
                          href={`/stock/${r.tsCode}`}
                          className="text-ink-soft hover:text-ink"
                        >
                          查看 →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-ink-mute">
            还没有命中数据。
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <div className="card p-3 sm:p-4">
      <div className="text-[11px] sm:text-xs text-ink-mute mb-1 truncate">
        {label}
      </div>
      <div className="flex items-baseline gap-1 sm:gap-2 flex-wrap">
        <div className="text-lg sm:text-2xl font-semibold leading-none">
          {value}
        </div>
        {unit && (
          <div className="text-[11px] sm:text-sm text-ink-soft truncate">
            {unit}
          </div>
        )}
      </div>
    </div>
  );
}

function PositionsSection({
  stockIdx,
  treasury,
}: {
  stockIdx: ProductSnapshot | null;
  treasury: ProductSnapshot | null;
}) {
  if (!stockIdx && !treasury) {
    // 两个数据源都失败时整体不渲染，避免空卡占位
    return null;
  }
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span>⚖️</span>
          <span>主力多空持仓</span>
        </h2>
        <p className="text-xs text-ink-mute">
          数据：中金所前 20 会员席位 · 盘后约 17:00 更新
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <PositionCard
          title="机构 · 股指期货"
          subtitle="IF（沪深 300）— 反映机构主力对 A 股短期方向的判断"
          snapshot={stockIdx}
          accentClass="text-accent"
        />
        <PositionCard
          title="央妈 · 国债期货"
          subtitle="T（10 年期国债）— 反映对货币政策与流动性的预期"
          snapshot={treasury}
          accentClass="text-amber-400"
        />
      </div>
    </section>
  );
}

function PositionCard({
  title,
  subtitle,
  snapshot,
  accentClass,
}: {
  title: string;
  subtitle: string;
  snapshot: ProductSnapshot | null;
  accentClass: string;
}) {
  if (!snapshot || !snapshot.dominant) {
    return (
      <div className="card p-4">
        <div className="flex items-baseline justify-between mb-1">
          <h3 className={cn("font-semibold", accentClass)}>{title}</h3>
        </div>
        <p className="text-xs text-ink-mute mb-3">{subtitle}</p>
        <div className="text-sm text-ink-mute py-6 text-center">
          暂无数据（中金所盘后才会发布）
        </div>
      </div>
    );
  }

  const dom = snapshot.dominant;
  const sent = netSentiment(dom);
  const total = dom.longTotal + dom.shortTotal || 1;
  const longPct = (dom.longTotal / total) * 100;
  const tdy = `${snapshot.tradingDay.slice(0, 4)}-${snapshot.tradingDay.slice(4, 6)}-${snapshot.tradingDay.slice(6, 8)}`;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h3 className={cn("font-semibold", accentClass)}>{title}</h3>
          <p className="text-xs text-ink-mute">{subtitle}</p>
        </div>
        <div className="text-right text-xs text-ink-mute">
          <div>
            主力 <span className="font-mono text-ink">{dom.instrumentId}</span>
          </div>
          <div>
            交易日 <span className="font-mono">{tdy}</span>
          </div>
        </div>
      </div>

      {/* 净持仓概览 */}
      <div className="rounded-lg bg-bg-soft/40 border border-line p-3">
        <div className="flex items-baseline justify-between mb-2">
          <span className={cn(
            "text-sm font-medium",
            sent.bias === "long" && "text-bull",
            sent.bias === "short" && "text-bear",
            sent.bias === "balanced" && "text-ink-soft"
          )}>
            {sent.label}
          </span>
          <span className="text-xs text-ink-mute font-mono">
            净 {sent.net > 0 ? "+" : ""}
            {sent.net.toLocaleString()} ({(sent.netPct * 100).toFixed(1)}%)
          </span>
        </div>
        {/* 多空总持仓占比条 */}
        <div className="h-2 rounded-full overflow-hidden flex bg-bg-soft border border-line">
          <div className="bg-bull/70" style={{ width: `${longPct}%` }} />
          <div className="bg-bear/70 flex-1" />
        </div>
        <div className="flex justify-between text-xs mt-1.5 font-mono">
          <span className="text-bull">
            多 {dom.longTotal.toLocaleString()}
            <VarBadge v={dom.longVarTotal} />
          </span>
          <span className="text-bear">
            空 {dom.shortTotal.toLocaleString()}
            <VarBadge v={dom.shortVarTotal} />
          </span>
        </div>
      </div>

      {/* Top 5 多 / 空 席位（手机上上下排列） */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <RankList title="多头 Top 5" items={dom.longs.slice(0, 5)} side="long" />
        <RankList title="空头 Top 5" items={dom.shorts.slice(0, 5)} side="short" />
      </div>

      {/* 其他合约简要 */}
      {snapshot.contracts.length > 1 && (
        <details className="border-t border-line pt-2">
          <summary className="text-xs text-ink-soft cursor-pointer hover:text-ink">
            其它合约（{snapshot.contracts.length - 1}）
          </summary>
          <table className="w-full text-xs mt-2 font-mono">
            <thead className="text-ink-mute">
              <tr>
                <th className="text-left py-1">合约</th>
                <th className="text-right py-1">多</th>
                <th className="text-right py-1">空</th>
                <th className="text-right py-1">净</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.contracts
                .filter((c) => c.instrumentId !== dom.instrumentId)
                .map((c) => {
                  const s = netSentiment(c);
                  return (
                    <tr key={c.instrumentId} className="text-ink-soft">
                      <td className="py-1">{c.instrumentId}</td>
                      <td className="text-right py-1 text-bull">
                        {c.longTotal.toLocaleString()}
                      </td>
                      <td className="text-right py-1 text-bear">
                        {c.shortTotal.toLocaleString()}
                      </td>
                      <td
                        className={cn(
                          "text-right py-1",
                          s.bias === "long" && "text-bull",
                          s.bias === "short" && "text-bear"
                        )}
                      >
                        {s.net > 0 ? "+" : ""}
                        {s.net.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function RankList({
  title,
  items,
  side,
}: {
  title: string;
  items: ContractPositions["longs"];
  side: "long" | "short";
}) {
  const colorClass = side === "long" ? "text-bull" : "text-bear";
  return (
    <div>
      <div className={cn("text-xs font-medium mb-1.5", colorClass)}>{title}</div>
      <ul className="space-y-1 text-xs">
        {items.map((m) => (
          <li key={m.rank} className="flex items-center gap-1.5">
            <span className="text-ink-mute font-mono w-3 text-right">
              {m.rank}
            </span>
            <span className="flex-1 truncate text-ink-soft" title={m.shortname}>
              {m.shortname.replace(/\(代客\)/g, "")}
            </span>
            <span className="font-mono text-ink">
              {m.volume.toLocaleString()}
            </span>
            <VarBadge v={m.varvolume} small />
          </li>
        ))}
      </ul>
    </div>
  );
}

function VarBadge({ v, small = false }: { v: number; small?: boolean }) {
  if (!v) {
    return (
      <span className={cn("ml-1 text-ink-mute font-mono", small ? "text-[10px]" : "text-xs")}>
        ±0
      </span>
    );
  }
  const cls = v > 0 ? "text-bull" : "text-bear";
  const sign = v > 0 ? "+" : "";
  return (
    <span className={cn("ml-1 font-mono", small ? "text-[10px]" : "text-xs", cls)}>
      {sign}
      {v.toLocaleString()}
    </span>
  );
}

function FuturesSettlementCard({
  events,
}: {
  events: ReturnType<typeof getFuturesSettlementDates>;
}) {
  if (!events.length) return null;
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span>⏰</span>
            <span>期货交割日提醒</span>
          </h2>
          <p className="text-xs text-ink-mute mt-0.5">
            股指期货 / 期权 每月第三个周五 · 国债期货 季度末第二个周五（节假日可能顺延）
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {events.map((e) => {
          const isToday = e.daysFromToday === 0;
          const isSoon = e.daysFromToday > 0 && e.daysFromToday <= 3;
          const isStockIdx = e.type === "stock-index";
          return (
            <div
              key={`${e.date}-${e.type}`}
              className={cn(
                "rounded-lg border p-3 transition-colors",
                isToday &&
                  "border-bear/60 bg-bear/10 ring-1 ring-bear/40 animate-pulse",
                !isToday && isSoon && "border-amber-500/50 bg-amber-500/10",
                !isToday && !isSoon && "border-line bg-bg-soft/30"
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div
                  className={cn(
                    "font-mono text-sm font-medium",
                    isToday && "text-bear",
                    isSoon && !isToday && "text-amber-400"
                  )}
                >
                  {e.date}
                </div>
                <span
                  className={cn(
                    "text-xs px-1.5 py-0.5 rounded",
                    isToday && "bg-bear/20 text-bear font-semibold",
                    !isToday && isSoon && "bg-amber-500/20 text-amber-400 font-semibold",
                    !isToday && !isSoon && "text-ink-mute"
                  )}
                >
                  {isToday
                    ? "今日"
                    : e.daysFromToday < 0
                      ? "今日附近"
                      : `${e.daysFromToday} 天后`}
                </span>
              </div>
              <div className="text-xs text-ink-soft mt-2">{e.label}</div>
              <div className="text-xs font-mono text-ink-mute mt-1">
                {isStockIdx ? "IF/IH/IC/IM" : "TS/TF/T/TL"}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * 游资热榜（龙虎榜·游资主导）：按净买额降序展示当日 Top N。
 * 数据失败 / 空时整体不渲染，避免占位卡。
 */
function LhbHotSection({ snap }: { snap: LhbHotSnapshot | null }) {
  if (!snap || snap.items.length === 0) return null;

  const tdy = `${snap.tradeDate.slice(0, 4)}-${snap.tradeDate.slice(4, 6)}-${snap.tradeDate.slice(6, 8)}`;
  const totalNet = snap.items.reduce((s, it) => s + it.netAmt, 0);
  const youziLed = snap.items.length;

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span>⚡</span>
          <span>游资热榜</span>
          <span className="text-xs text-ink-mute font-normal">
            龙虎榜 · 游资主导个股
          </span>
        </h2>
        <p className="text-xs text-ink-mute">
          数据：东方财富 · 交易日 <span className="font-mono">{tdy}</span>
        </p>
      </div>

      <div className="card p-3 sm:p-4">
        {/* 顶部统计 */}
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap text-xs sm:text-sm">
          <div className="text-ink-soft">
            上榜个股 <span className="text-ink font-mono">{snap.totalListed}</span> 只
            <span className="mx-2 text-ink-mute">·</span>
            游资主导 <span className="text-accent font-mono">{youziLed}</span> 只
          </div>
          <div className="text-ink-soft">
            游资净买合计{" "}
            <span
              className={cn(
                "font-mono",
                totalNet > 0 ? "text-bear" : totalNet < 0 ? "text-bull" : "text-ink"
              )}
            >
              {formatMoneyCN(totalNet, true)}
            </span>
          </div>
        </div>

        {/* 列表 */}
        <div className="overflow-x-auto table-scroll -mx-3 sm:mx-0">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-ink-mute text-left text-xs">
              <tr className="border-b border-line">
                <th className="py-2 px-3 sm:px-0 font-medium w-8">#</th>
                <th className="py-2 font-medium">代码 / 名称</th>
                <th className="py-2 font-medium text-right">涨幅</th>
                <th className="py-2 font-medium text-right">游资净买</th>
                <th className="py-2 font-medium text-right">占成交</th>
                <th className="py-2 pr-3 sm:pr-0 font-medium">原因 / 席位</th>
              </tr>
            </thead>
            <tbody>
              {snap.items.map((it, idx) => (
                <LhbRow key={it.tsCode} item={it} rank={idx + 1} />
              ))}
            </tbody>
          </table>
        </div>

        {/* 口径说明 */}
        <p className="text-[11px] text-ink-mute mt-3 leading-relaxed">
          口径：买入 Top 5 席位中「营业部 / 普通席位」数量多于「机构席位」即视为游资主导；
          同一只股多条上榜按最大净买保留。颜色：
          <span className="text-bear mx-1">红</span>= 涨 / 净买，
          <span className="text-bull mx-1">绿</span>= 跌 / 净卖。
        </p>
      </div>
    </section>
  );
}

function LhbRow({ item, rank }: { item: LhbHotItem; rank: number }) {
  const up = item.changeRate > 0;
  const down = item.changeRate < 0;
  const net = item.netAmt;
  const netPos = net > 0;

  return (
    <tr className="border-b border-line/50 hover:bg-bg-soft/40">
      <td className="py-2 px-3 sm:px-0 text-ink-mute font-mono">{rank}</td>
      <td className="py-2">
        <Link
          href={`/stock/${item.tsCode}`}
          className="block hover:text-accent transition-colors"
        >
          <div className="font-mono text-xs text-ink-soft">{item.tsCode}</div>
          <div className="font-medium truncate max-w-[10em]" title={item.name}>
            {item.name}
          </div>
        </Link>
      </td>
      <td
        className={cn(
          "py-2 text-right font-mono",
          up && "text-bear",
          down && "text-bull"
        )}
      >
        {up ? "+" : ""}
        {item.changeRate.toFixed(2)}%
      </td>
      <td
        className={cn(
          "py-2 text-right font-mono",
          netPos ? "text-bear" : "text-bull"
        )}
      >
        {formatMoneyCN(net, true)}
      </td>
      <td className="py-2 text-right font-mono text-ink-soft">
        {item.dealNetRatio ? `${item.dealNetRatio.toFixed(1)}%` : "—"}
      </td>
      <td className="py-2 pr-3 sm:pr-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="px-1.5 py-0.5 rounded bg-bg-soft/60 border border-line text-[11px] text-ink-soft">
            {shortReason(item.explanation)}
          </span>
          {item.isPureYouzi ? (
            <span className="px-1.5 py-0.5 rounded bg-accent/15 border border-accent/40 text-[11px] text-accent">
              纯游资
            </span>
          ) : item.buyInstCount > 0 ? (
            <span
              className="px-1.5 py-0.5 rounded bg-bg-soft/40 border border-line text-[11px] text-ink-mute"
              title={item.explain}
            >
              机构 {item.buyInstCount}
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

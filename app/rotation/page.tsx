import Link from "next/link";
import {
  buildRotationSnapshot,
  stateLabel,
  stateColor,
  type IndustryMetric,
  type RotationState,
} from "@/lib/rotation/aggregator";
import { compactDate, cn, formatNumber, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function RotationPage() {
  const snap = await buildRotationSnapshot(22);

  // 按 state 分组
  const byState = new Map<RotationState, IndustryMetric[]>();
  for (const ind of snap.industries) {
    const arr = byState.get(ind.state);
    if (arr) arr.push(ind);
    else byState.set(ind.state, [ind]);
  }
  const leading = byState.get("leading") ?? [];
  const rotatingIn = byState.get("rotating-in") ?? [];
  const rotatingOut = byState.get("rotating-out") ?? [];
  const lagging = byState.get("lagging") ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">板块轮动</h1>
          <p className="text-sm text-ink-soft mt-1">
            按申万一级行业聚合 · 1 / 5 / 20 日涨幅 + 趋势宽度 + 动能加速度 ·
            实时分时合并：{snap.realtime ? "✓" : "—"}
          </p>
        </div>
        <div className="text-xs text-ink-mute">
          数据截至 <span className="font-mono">{compactDate(snap.asOf)}</span> ·
          覆盖 <b className="text-ink">{snap.industries.length}</b> 个板块
          {snap.uncovered > 0 && ` · 未覆盖 ${snap.uncovered} 只`}
        </div>
      </div>

      {/* 四种轮动状态概览卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StateCard
          title="主升 · 强势主线"
          desc="趋势完好 + 多周期共振"
          state="leading"
          industries={leading}
        />
        <StateCard
          title="轮入 · 新热点"
          desc="今日异动 + 动能加速"
          state="rotating-in"
          industries={rotatingIn}
        />
        <StateCard
          title="轮出 · 高位退潮"
          desc="今日大幅回吐 + 趋势宽度下降"
          state="rotating-out"
          industries={rotatingOut}
        />
        <StateCard
          title="弱势 · 持续下行"
          desc="多周期都跌"
          state="lagging"
          industries={lagging}
        />
      </div>

      {/* 完整板块排行 */}
      <section className="card overflow-hidden">
        <div className="px-3 sm:px-4 py-2 border-b border-line flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-base font-semibold">📊 全板块排行（按今日涨幅）</h2>
          <div className="flex items-center gap-2 text-xs text-ink-mute flex-wrap">
            <Legend color="bg-bull/40" label="今日涨" />
            <Legend color="bg-bear/40" label="今日跌" />
            <Legend color="bg-amber-300" label="轮入" />
            <Legend color="bg-purple-500/40" label="轮出" />
          </div>
        </div>
        <div className="overflow-x-auto table-scroll">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="text-ink-soft text-left">
              <tr className="border-b border-line">
                <th className="py-2 px-3 sm:px-4 font-medium">板块</th>
                <th className="py-2 px-4 font-medium">状态</th>
                <th className="py-2 px-4 font-medium text-right">成员</th>
                <th className="py-2 px-4 font-medium text-right">1 日</th>
                <th className="py-2 px-4 font-medium text-right">5 日</th>
                <th className="py-2 px-4 font-medium text-right">20 日</th>
                <th className="py-2 px-4 font-medium text-right">量比</th>
                <th className="py-2 px-4 font-medium text-right">趋势宽度</th>
                <th className="py-2 px-4 font-medium">领涨成分</th>
              </tr>
            </thead>
            <tbody>
              {snap.industries.map((ind) => (
                <IndustryRow key={ind.industry} ind={ind} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-ink-mute leading-relaxed">
        说明：板块涨跌幅 = 成分股等权平均；趋势宽度 = 当前价 &gt; MA20
        的成分股占比；量比 = 今日量 / 5 日均量。
        盘中开市时间页面会自动用实时分时价覆盖最后一根 K
        线，让排名随分时跳动。
      </p>
    </div>
  );
}

function StateCard({
  title,
  desc,
  state,
  industries,
}: {
  title: string;
  desc: string;
  state: RotationState;
  industries: IndustryMetric[];
}) {
  const c = stateColor(state);
  const top = industries.slice(0, 5);
  return (
    <div
      className={cn(
        "card p-3 sm:p-4 space-y-2 border",
        c.border,
        c.bg.replace("/15", "/5")
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className={cn("text-sm font-semibold", c.text)}>{title}</div>
          <div className="text-[11px] text-ink-mute mt-0.5">{desc}</div>
        </div>
        <div className={cn("text-2xl font-semibold", c.text)}>
          {industries.length}
        </div>
      </div>
      {top.length > 0 ? (
        <ul className="space-y-1 text-xs">
          {top.map((ind) => (
            <li
              key={ind.industry}
              className="flex items-center justify-between gap-2"
            >
              <span className="truncate">{ind.industry}</span>
              <span
                className={cn(
                  "font-mono shrink-0",
                  ind.return1d >= 0 ? "text-bull" : "text-bear"
                )}
              >
                {ind.return1d >= 0 ? "+" : ""}
                {formatPercent(ind.return1d)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-ink-mute">暂无</div>
      )}
    </div>
  );
}

function IndustryRow({ ind }: { ind: IndustryMetric }) {
  const c = stateColor(ind.state);
  return (
    <tr className="border-b border-line/50 hover:bg-bg-muted">
      <td className="py-2 px-3 sm:px-4 font-medium">{ind.industry}</td>
      <td className="py-2 px-4">
        <span
          className={cn("badge text-xs border", c.bg, c.text, c.border)}
        >
          {stateLabel(ind.state)}
        </span>
      </td>
      <td className="py-2 px-4 text-right text-ink-soft font-mono">
        {ind.count}
      </td>
      <ReturnCell value={ind.return1d} />
      <ReturnCell value={ind.return5d} />
      <ReturnCell value={ind.return20d} />
      <td className="py-2 px-4 text-right font-mono">
        <span
          className={cn(
            ind.volRatio >= 1.5
              ? "text-bull"
              : ind.volRatio < 0.7
                ? "text-bear"
                : "text-ink-soft"
          )}
        >
          {formatNumber(ind.volRatio, 2)}
        </span>
      </td>
      <td className="py-2 px-4">
        <BreadthBar value={ind.breadth} />
      </td>
      <td className="py-2 px-4">
        <div className="flex flex-wrap gap-1">
          {ind.topMovers.slice(0, 3).map((m) => (
            <Link
              key={m.tsCode}
              href={`/stock/${encodeURIComponent(m.tsCode)}`}
              className={cn(
                "badge text-[10px] border",
                m.return1d >= 0
                  ? "bg-bull/10 text-bull border-bull/30"
                  : "bg-bear/10 text-bear border-bear/30",
                "hover:underline"
              )}
              title={`${m.name} · ${formatNumber(m.close)}`}
            >
              {m.name}
              <span className="ml-1 font-mono">
                {m.return1d >= 0 ? "+" : ""}
                {formatPercent(m.return1d)}
              </span>
            </Link>
          ))}
        </div>
      </td>
    </tr>
  );
}

function ReturnCell({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <td className="py-2 px-4 text-right font-mono">
      <span className={cn(positive ? "text-bull" : "text-bear")}>
        {positive ? "+" : ""}
        {formatPercent(value)}
      </span>
    </td>
  );
}

function BreadthBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.7
      ? "bg-bull"
      : value >= 0.4
        ? "bg-amber-500"
        : "bg-bear";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 bg-bg-soft rounded-full overflow-hidden">
        <div
          className={cn("h-full transition-all", tone)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-ink-soft">{pct}%</span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("w-2.5 h-2.5 rounded", color)} />
      <span>{label}</span>
    </span>
  );
}

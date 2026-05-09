"use client";

import Link from "next/link";
import { useState, useTransition, useMemo } from "react";
import type { ScanFormState } from "./actions";
import {
  resolvePoolTsCodes,
  runScanChunk,
  persistScanResults,
  type SerializedItem,
} from "./chunk-actions";
import { syncFullUniverse, type SyncResult } from "./sync-actions";
import { Sparkline } from "./sparkline";
import { pickTopRecommendations } from "@/lib/screener/recommend";
import { cn, formatNumber } from "@/lib/utils";

interface StrategyLite {
  id: string;
  name: string;
  description: string | null;
  ruleConfig: string;
}

interface Props {
  strategies: StrategyLite[];
  builtinCount: number;
  totalStockCount: number;
  watchlistCount: number;
}

type PoolType = "builtin" | "full" | "watchlist" | "custom";

interface Progress {
  done: number;
  total: number;
  /** 每批耗时滑动平均（毫秒），用于估算剩余时间 */
  avgChunkMs: number;
}

/** 单个 chunk 内股票数。Hobby 60s 函数上限 + 腾讯并发 8、平均 0.4s/只冷拉 */
const CHUNK_SIZE = 600;

export default function ScanForm({
  strategies,
  builtinCount,
  totalStockCount,
  watchlistCount,
}: Props) {
  const [strategyId, setStrategyId] = useState(strategies[0]?.id ?? "");
  const [poolType, setPoolType] = useState<PoolType>("builtin");
  const [customCodes, setCustomCodes] = useState("");
  const [persist, setPersist] = useState(true);
  /** 默认开启：每次扫描都补当日 K 线，避免错过当日行情 */
  const [forceRefresh, setForceRefresh] = useState(true);
  const [state, setState] = useState<ScanFormState | null>(null);
  const [isPending, startTransition] = useTransition();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [currentTotal, setCurrentTotal] = useState(totalStockCount);

  const selectedStrategy = strategies.find((s) => s.id === strategyId);
  const ruleConfig = selectedStrategy
    ? (JSON.parse(selectedStrategy.ruleConfig) as {
        conditions: Array<{ type: string }>;
      })
    : null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (poolType === "full" && currentTotal < 200) {
      window.alert("全 A 股池为空。请先点击『同步全 A 股』按钮再扫描。");
      return;
    }

    startTransition(async () => {
      setState(null);
      setProgress(null);

      // 1) 解析股票池
      const resolved = await resolvePoolTsCodes({ poolType, customCodes });
      if (!resolved.ok || !resolved.tsCodes) {
        setState({ ok: false, message: resolved.message ?? "解析股票池失败" });
        return;
      }
      const tsCodes = resolved.tsCodes;

      // 2) 切 chunk 顺序调用
      const allItems: SerializedItem[] = [];
      const allFailed: string[] = [];
      let scanDate = "";
      const chunkTimes: number[] = [];

      setProgress({ done: 0, total: tsCodes.length, avgChunkMs: 0 });

      for (let i = 0; i < tsCodes.length; i += CHUNK_SIZE) {
        const chunk = tsCodes.slice(i, i + CHUNK_SIZE);
        const t0 = Date.now();
        const r = await runScanChunk({
          strategyId,
          tsCodes: chunk,
          forceRefresh,
        });
        chunkTimes.push(Date.now() - t0);

        if (!r.ok) {
          // 单批失败：把整批列入 failed，继续下一批
          allFailed.push(...chunk);
          console.warn("[chunk] 失败:", r.message);
        } else {
          if (r.items) allItems.push(...r.items);
          if (r.failed) allFailed.push(...r.failed);
          if (r.scanDate && !scanDate) scanDate = r.scanDate;
        }

        const avg =
          chunkTimes.reduce((s, x) => s + x, 0) / chunkTimes.length;
        setProgress({
          done: Math.min(i + chunk.length, tsCodes.length),
          total: tsCodes.length,
          avgChunkMs: avg,
        });
      }

      // 3) 排序聚合
      allItems.sort((a, b) => b.score - a.score);
      const hitCount = allItems.filter((x) => x.pass).length;

      // 4) 落库（如勾选）—— 仅传必要字段，避开 server action 2MB body 限制
      let scanRunId: string | undefined;
      if (persist) {
        const p = await persistScanResults({
          strategyId,
          scanDate: scanDate,
          items: allItems.map((it) => ({
            tsCode: it.tsCode,
            score: it.score,
            pass: it.pass,
            close: it.close,
          })),
          totalCount: tsCodes.length,
        });
        if (p.ok) scanRunId = p.scanRunId;
        else
          console.warn("[persist] 失败（结果已显示，仅未落历史）:", p.message);
      }

      setState({
        ok: true,
        scanRunId,
        scanDate,
        hitCount,
        total: tsCodes.length,
        failed: allFailed,
        results: allItems,
      });
      setProgress(null);
    });
  }

  function onSync() {
    if (syncing) return;
    setSyncing(true);
    setSyncResult(null);
    syncFullUniverse()
      .then((r) => {
        setSyncResult(r);
        if (r.ok && r.total != null) {
          setCurrentTotal(r.total);
        }
      })
      .finally(() => setSyncing(false));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="strategyId" value={strategyId} />
      <input type="hidden" name="poolType" value={poolType} />
      <input type="hidden" name="persist" value={persist ? "1" : "0"} />

      <section className="card p-3 sm:p-4 grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
        <div>
          <label className="text-sm text-ink-soft block mb-1.5">策略</label>
          <select
            className="input w-full"
            value={strategyId}
            onChange={(e) => setStrategyId(e.target.value)}
          >
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {selectedStrategy?.description && (
            <p className="text-xs text-ink-mute mt-1.5">
              {selectedStrategy.description}
            </p>
          )}
        </div>

        <div>
          <label className="text-sm text-ink-soft block mb-1.5">股票池</label>
          <select
            className="input w-full"
            value={poolType}
            onChange={(e) => setPoolType(e.target.value as PoolType)}
          >
            <option value="builtin">内置精选（{builtinCount} 只）</option>
            <option value="full">
              全 A 股（{currentTotal >= 200 ? `${currentTotal} 只` : "未同步"}）
            </option>
            <option value="watchlist">自选股（{watchlistCount} 只）</option>
            <option value="custom">自定义代码列表</option>
          </select>
          {poolType === "full" && (
            <button
              type="button"
              onClick={onSync}
              className="btn mt-2 w-full text-xs"
              disabled={syncing}
            >
              {syncing ? "同步中…（约 10 秒）" : "↻ 同步全 A 股"}
            </button>
          )}
        </div>

        <div className="flex items-end">
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={forceRefresh}
                onChange={(e) => setForceRefresh(e.target.checked)}
                className="accent-accent"
              />
              <span>
                实时拉取最新 K 线
                <span className="text-ink-mute text-xs ml-1">
                  （取消勾选可走缓存极速完成）
                </span>
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={persist}
                onChange={(e) => setPersist(e.target.checked)}
                className="accent-accent"
              />
              将本次扫描结果存入历史
            </label>
          </div>
        </div>
      </section>

      {poolType === "custom" && (
        <textarea
          name="customCodes"
          rows={4}
          className="input w-full font-mono text-xs"
          placeholder={"自定义代码，每行一个，如：\n600519.SH\nsz000858\n688981"}
          value={customCodes}
          onChange={(e) => setCustomCodes(e.target.value)}
        />
      )}

      {syncResult && (
        <div
          className={cn(
            "card p-3 text-sm",
            syncResult.ok ? "text-bull border-bull/40" : "text-bear border-bear/40"
          )}
        >
          {syncResult.ok
            ? `同步完成：共 ${syncResult.total} 只（新增 ${syncResult.inserted}，更新 ${syncResult.updated}），耗时 ${syncResult.durationMs}ms`
            : `同步失败：${syncResult.message}`}
        </div>
      )}

      {poolType === "full" && currentTotal >= 200 && (
        <div className="card p-3 text-xs text-ink-soft border-accent/20 bg-accent/5">
          <b className="text-accent">提示</b>：扫描全 A 股
          {currentTotal} 只首次需 5-10 分钟（每只拉腾讯 K 线约 100ms）。
          之后由本地缓存提供，再次扫描通常 &lt; 30 秒。建议先小池子（内置/自选）跑通，再尝试全市场。
        </div>
      )}

      {ruleConfig && (
        <section className="card p-4">
          <div className="text-sm text-ink-soft mb-2">命中规则需同时满足：</div>
          <div className="flex flex-wrap gap-2">
            {ruleConfig.conditions.map((c, i) => (
              <span
                key={i}
                className="badge bg-bg-soft text-ink-soft border border-line"
              >
                {c.type}
              </span>
            ))}
          </div>
        </section>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={isPending || !strategyId}
        >
          {isPending
            ? progress
              ? `扫描中 ${progress.done}/${progress.total}…`
              : "扫描中…"
            : "开始扫描"}
        </button>
        {state?.results && state.results.length > 0 && (
          <button
            type="button"
            className="btn"
            onClick={() => exportCSV(state)}
          >
            导出 CSV
          </button>
        )}
      </div>

      {progress && progress.total > 0 && (
        <ScanProgress progress={progress} chunkSize={CHUNK_SIZE} />
      )}

      {state && !state.ok && (
        <div className="card p-3 text-sm text-bear border-bear/40">
          {state.message}
        </div>
      )}

      {state?.ok && state.results && (
        <ResultsTable state={state} />
      )}
    </form>
  );
}

function ScanProgress({
  progress,
  chunkSize,
}: {
  progress: Progress;
  chunkSize: number;
}) {
  const pct = progress.total
    ? Math.min(100, Math.round((progress.done / progress.total) * 100))
    : 0;
  const remainingChunks = Math.max(
    0,
    Math.ceil((progress.total - progress.done) / chunkSize)
  );
  const etaMs = progress.avgChunkMs * remainingChunks;
  const etaText =
    progress.avgChunkMs > 0
      ? etaMs > 60_000
        ? `约 ${Math.ceil(etaMs / 60_000)} 分钟`
        : `约 ${Math.ceil(etaMs / 1000)} 秒`
      : "估算中…";

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center justify-between text-xs text-ink-soft flex-wrap gap-2">
        <div>
          已扫描 <b className="text-ink">{progress.done}</b> /{" "}
          <b className="text-ink">{progress.total}</b> 只（{pct}%）
        </div>
        <div>
          预计剩余 <b className="text-ink">{etaText}</b>
        </div>
      </div>
      <div className="h-2 w-full bg-bg-soft rounded-full overflow-hidden">
        <div
          className="h-full bg-accent transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-ink-mute">
        分批扫描中（每批 {chunkSize} 只，约 30–50 秒）。首次冷拉腾讯 K
        线较慢，之后由数据库缓存提供，再次扫描会大幅加快。
      </div>
    </div>
  );
}

function ResultsTable({ state }: { state: ScanFormState }) {
  const hits = state.results!.filter((r) => r.pass);
  const partials = state.results!.filter((r) => !r.pass).slice(0, 30);

  // 命中股票里挑出 Top 2「值得买入」推荐
  const tops = useMemo(() => pickTopRecommendations(hits, 2), [hits]);
  const topSet = useMemo(
    () => new Set(tops.map((t) => t.tsCode)),
    [tops]
  );

  return (
    <div className="space-y-3">
      <div className="text-sm text-ink-soft">
        扫描完成：共 <b className="text-ink">{state.total}</b> 只，命中{" "}
        <b className="text-bull">{state.hitCount}</b> 只，失败{" "}
        <b>{state.failed?.length ?? 0}</b> 只。
      </div>

      {tops.length > 0 && <RecommendCards tops={tops} />}

      <div className="card overflow-hidden">
        <div className="px-3 sm:px-4 py-2 border-b border-line text-sm font-medium">
          命中（{hits.length}）
        </div>
        <ResultRows rows={hits} hideZeroScore={false} topSet={topSet} />
      </div>

      {partials.length > 0 && (
        <details className="card overflow-hidden">
          <summary className="px-3 sm:px-4 py-2 border-b border-line text-sm font-medium cursor-pointer text-ink-soft">
            部分命中（按评分排序，前 {partials.length} 条）
          </summary>
          <ResultRows rows={partials} hideZeroScore topSet={topSet} />
        </details>
      )}
    </div>
  );
}

function RecommendCards({
  tops,
}: {
  tops: ReturnType<typeof pickTopRecommendations<NonNullable<ScanFormState["results"]>[number]>>;
}) {
  return (
    <div className="card overflow-hidden border-amber-500/40 bg-amber-500/5">
      <div className="px-3 sm:px-4 py-2 border-b border-amber-500/30 text-sm font-medium flex items-center gap-2 flex-wrap">
        <span className="text-amber-400">⭐ 值得操作（综合置信度 Top {tops.length}）</span>
        <span className="text-ink-mute text-xs hidden sm:inline">
          基于技术评分 / 量比 / 30 日走势 / 波动 / 均线位置 加权
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3">
        {tops.map((t, idx) => (
          <div
            key={t.tsCode}
            className="rounded-lg border border-amber-500/30 bg-bg-soft/40 p-3 space-y-2"
          >
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-amber-400 font-semibold">#{idx + 1}</span>
                <Link
                  href={`/stock/${t.tsCode}`}
                  className="font-mono text-base text-accent hover:underline"
                >
                  {t.tsCode}
                </Link>
                <span className="text-ink">{t.name ?? "—"}</span>
                {t.board && (
                  <span className="badge bg-bg-soft text-ink-soft border border-line text-xs">
                    {t.board}
                  </span>
                )}
                {t.industry && (
                  <span className="badge bg-accent/10 text-accent border border-accent/30 text-xs">
                    {t.industry}
                  </span>
                )}
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold text-amber-400 leading-none">
                  {t.rec.confidence}
                </div>
                <div className="text-xs text-ink-mute">置信度</div>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="text-xs text-ink-soft">
                现价 <span className="font-mono text-ink">{formatNumber(t.close)}</span>
                <span className="mx-2 text-line">·</span>
                量比 <span className="font-mono text-ink">{formatNumber(t.volRatio)}</span>
                <span className="mx-2 text-line">·</span>
                评分 <span className="font-mono text-ink">{t.score}/{t.maxScore}</span>
              </div>
              {t.recentCloses && (
                <Sparkline values={t.recentCloses} width={140} height={36} />
              )}
            </div>

            {t.rec.reasons.length > 0 && (
              <ul className="text-xs space-y-1 mt-1">
                {t.rec.reasons.map((reason, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-ink-soft">
                    <span className="text-bull mt-[1px]">✓</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            )}

            {t.rec.risks.length > 0 && (
              <ul className="text-xs space-y-1">
                {t.rec.risks.map((risk, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-ink-mute">
                    <span className="text-amber-500 mt-[1px]">!</span>
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="pt-1">
              <Link
                href={`/stock/${t.tsCode}`}
                className="text-accent text-xs hover:underline"
              >
                查看 K 线与详细指标 →
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultRows({
  rows,
  hideZeroScore,
  topSet,
}: {
  rows: NonNullable<ScanFormState["results"]>;
  hideZeroScore: boolean;
  topSet?: Set<string>;
}) {
  if (!rows.length) {
    return <div className="px-4 py-6 text-center text-ink-mute text-sm">无数据</div>;
  }
  const filtered = hideZeroScore ? rows.filter((r) => r.score > 0) : rows;
  return (
    <div className="overflow-x-auto table-scroll">
      <table className="w-full text-sm min-w-[860px]">
        <thead className="text-ink-soft text-left">
          <tr className="border-b border-line">
            <th className="py-2 px-3 sm:px-4 font-medium">代码</th>
            <th className="py-2 px-4 font-medium">名称</th>
            <th className="py-2 px-4 font-medium">板块</th>
            <th className="py-2 px-4 font-medium">行业</th>
            <th className="py-2 px-4 font-medium">评分</th>
            <th className="py-2 px-4 font-medium">收盘</th>
            <th className="py-2 px-4 font-medium">量比</th>
            <th className="py-2 px-4 font-medium whitespace-nowrap">近 30 日</th>
            <th className="py-2 px-4 font-medium">条件</th>
            <th className="py-2 px-4 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => {
            const isTop = topSet?.has(r.tsCode);
            return (
            <tr
              key={r.tsCode}
              className={cn(
                "border-b border-line/50 hover:bg-bg-soft/40",
                r.pass && "bg-bull/5",
                isTop && "bg-amber-500/10 border-l-2 border-l-amber-400"
              )}
            >
              <td className="py-2 px-3 sm:px-4 font-mono whitespace-nowrap">
                {isTop && (
                  <span
                    className="text-amber-400 mr-1.5"
                    title="综合置信度 Top，值得操作"
                  >
                    ★
                  </span>
                )}
                {r.tsCode}
              </td>
              <td className="py-2 px-4">{r.name ?? "—"}</td>
              <td className="py-2 px-4">
                {r.board ? (
                  <span className="badge bg-bg-soft text-ink-soft border border-line">
                    {r.board}
                  </span>
                ) : (
                  <span className="text-ink-mute">—</span>
                )}
              </td>
              <td className="py-2 px-4 text-ink-soft">{r.industry ?? "—"}</td>
              <td className="py-2 px-4">
                <span className={cn("badge", r.pass ? "badge-pass" : "bg-bg-soft text-ink-soft")}>
                  {r.score}/{r.maxScore}
                </span>
              </td>
              <td className="py-2 px-4 font-mono">{formatNumber(r.close)}</td>
              <td className="py-2 px-4 font-mono">{formatNumber(r.volRatio)}</td>
              <td className="py-2 px-4">
                {r.recentCloses && r.recentCloses.length > 1 ? (
                  <Sparkline values={r.recentCloses} />
                ) : (
                  <span className="text-ink-mute text-xs">—</span>
                )}
              </td>
              <td className="py-2 px-4">
                <div className="flex flex-wrap gap-1">
                  {r.conditions.map((c, i) => (
                    <span
                      key={i}
                      className={cn(
                        "badge",
                        c.pass ? "badge-pass" : "badge-fail opacity-60"
                      )}
                      title={c.label}
                    >
                      {c.pass ? "✓" : "✗"}
                    </span>
                  ))}
                </div>
              </td>
              <td className="py-2 px-4">
                <Link
                  href={`/stock/${r.tsCode}`}
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
  );
}

function exportCSV(state: ScanFormState) {
  if (!state.results?.length) return;
  const headers = [
    "代码",
    "名称",
    "板块",
    "行业",
    "命中",
    "评分",
    "满分",
    "收盘",
    "量比",
    "近30日涨跌%",
  ];
  const lines = [headers.join(",")];
  for (const r of state.results) {
    let chgPct = "";
    if (r.recentCloses && r.recentCloses.length > 1) {
      const f = r.recentCloses[0];
      const l = r.recentCloses[r.recentCloses.length - 1];
      chgPct = (((l - f) / f) * 100).toFixed(2);
    }
    lines.push(
      [
        r.tsCode,
        r.name ?? "",
        r.board ?? "",
        r.industry ?? "",
        r.pass ? "1" : "0",
        r.score,
        r.maxScore,
        r.close,
        r.volRatio ?? "",
        chgPct,
      ].join(",")
    );
  }
  const blob = new Blob(["\ufeff" + lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `scan-${state.scanDate ?? "result"}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

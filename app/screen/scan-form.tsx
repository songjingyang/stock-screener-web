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
import type { FailedItem } from "@/lib/screener/runner";
import { syncFullUniverse, type SyncResult } from "./sync-actions";
import { Sparkline } from "./sparkline";
import { pickTopRecommendations } from "@/lib/screener/recommend";
import type { StrategyPlaybook } from "@/lib/screener/presets";
import { cn, formatNumber } from "@/lib/utils";

interface StrategyLite {
  id: string;
  name: string;
  description: string | null;
  ruleConfig: string;
  playbook: StrategyPlaybook | null;
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
  /** 默认开启：交易时段把实时分时价合并到最后一根 K 线 */
  const [mergeRealtime, setMergeRealtime] = useState(true);
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
      const allFailedDetail: FailedItem[] = [];
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
          mergeRealtime,
        });
        chunkTimes.push(Date.now() - t0);

        if (!r.ok) {
          // 单批失败：把整批列入 failed（原因记为 no_kline），继续下一批
          allFailed.push(...chunk);
          for (const c of chunk) {
            allFailedDetail.push({
              tsCode: c,
              reason: "no_kline",
              klineCount: 0,
            });
          }
          console.warn("[chunk] 失败:", r.message);
        } else {
          if (r.items) allItems.push(...r.items);
          if (r.failed) allFailed.push(...r.failed);
          if (r.failedDetail) allFailedDetail.push(...r.failedDetail);
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
        failedDetail: allFailedDetail,
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
                checked={mergeRealtime}
                onChange={(e) => setMergeRealtime(e.target.checked)}
                className="accent-accent"
              />
              <span>
                用实时分时价驱动指标
                <span className="text-ink-mute text-xs ml-1">
                  （盘中按当前分时价计算，非交易时段自动失效）
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

      {selectedStrategy?.playbook && (
        <PlaybookCard
          name={selectedStrategy.name}
          playbook={selectedStrategy.playbook}
        />
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
        <ResultsTable
          state={state}
          strategyName={selectedStrategy?.name ?? ""}
          playbook={selectedStrategy?.playbook ?? null}
        />
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

function ResultsTable({
  state,
  strategyName,
  playbook,
}: {
  state: ScanFormState;
  strategyName: string;
  playbook: StrategyPlaybook | null;
}) {
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

      {state.failedDetail && state.failedDetail.length > 0 && (
        <FailureBreakdown failed={state.failedDetail} />
      )}

      {tops.length > 0 && (
        <RecommendCards
          tops={tops}
          strategyName={strategyName}
          playbook={playbook}
        />
      )}

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

function FailureBreakdown({ failed }: { failed: FailedItem[] }) {
  const byReason = useMemo(() => {
    const map = new Map<string, FailedItem[]>();
    for (const f of failed) {
      const arr = map.get(f.reason);
      if (arr) arr.push(f);
      else map.set(f.reason, [f]);
    }
    return map;
  }, [failed]);

  const labelOf = (r: string) =>
    r === "no_kline"
      ? "无 K 线（接口拉取失败 / 退市 / 长停牌）"
      : r === "insufficient"
        ? "K 线不足 70 根（新股 / 长停牌）"
        : r === "evaluate_error"
          ? "指标计算异常"
          : r;

  const colorOf = (r: string) =>
    r === "no_kline"
      ? "text-bear"
      : r === "insufficient"
        ? "text-ink-soft"
        : "text-amber-400";

  return (
    <details className="card overflow-hidden">
      <summary className="px-3 sm:px-4 py-2 border-b border-line text-sm font-medium cursor-pointer text-ink-soft flex flex-wrap gap-x-3 gap-y-1 items-center">
        <span className="text-ink">失败明细（{failed.length}）</span>
        {Array.from(byReason.entries()).map(([reason, list]) => (
          <span key={reason} className={cn("text-xs", colorOf(reason))}>
            {labelOf(reason)} <b>{list.length}</b>
          </span>
        ))}
      </summary>
      <div className="p-3 sm:p-4 space-y-3 text-xs">
        {Array.from(byReason.entries()).map(([reason, list]) => {
          // 在「无 K 线」分组里按 errorMessage 聚合，便于一眼看出主要失败类型
          const errStats =
            reason === "no_kline" ? aggregateErrors(list) : null;
          return (
            <div key={reason}>
              <div className={cn("font-medium mb-1.5", colorOf(reason))}>
                {labelOf(reason)} · {list.length} 只
              </div>
              {errStats && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 text-ink-soft">
                  {errStats.map((s) => (
                    <span key={s.key}>
                      <span className="text-ink">{s.label}</span>{" "}
                      <b className="font-mono">{s.count}</b>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {list.slice(0, 60).map((f) => (
                  <span
                    key={f.tsCode}
                    className="badge bg-bg-soft text-ink-soft border border-line font-mono"
                    title={
                      f.errorMessage
                        ? `${f.errorMessage} · K 线 ${f.klineCount} 根`
                        : `K 线 ${f.klineCount} 根`
                    }
                  >
                    {f.tsCode}
                  </span>
                ))}
                {list.length > 60 && (
                  <span className="text-ink-mute">…等 {list.length - 60} 只</span>
                )}
              </div>
            </div>
          );
        })}
        <p className="text-ink-mute pt-1 leading-relaxed">
          说明：A 股市场约有数百只长停牌 / 已退市 / 北交所新股缺少近 1
          年完整日 K 线，无法计算技术指标；属于市场结构性正常情况，与扫描质量无关。
          若「无 K 线」一栏的「NODATA」与「-1（限流）」很多，说明触发了腾讯接口限流，
          稍后再扫一次（缓存已落库的会跳过）通常显著改善。
        </p>
      </div>
    </details>
  );
}

/**
 * 把 no_kline 的 errorMessage 聚合成「Top 5 类别 + count」
 * 让用户一眼区分是「真退市 (NODATA)」、「限流 (-1)」、还是「超时/网络」
 */
function aggregateErrors(
  list: FailedItem[]
): Array<{ key: string; label: string; count: number }> {
  const map = new Map<string, number>();
  for (const f of list) {
    const key = classifyError(f.errorMessage);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

function classifyError(msg?: string): string {
  if (!msg) return "未知";
  if (msg.includes("NODATA")) return "NODATA（接口无数据）";
  if (msg.includes("Tencent:-1")) return "-1（腾讯限流）";
  if (msg.includes("Tencent:-")) {
    const m = msg.match(/Tencent:(-?\d+)/);
    return m ? `${m[1]}（接口业务错误）` : "腾讯业务错误";
  }
  if (msg.includes("HTTP") && /HTTP\]\s*5/.test(msg)) return "HTTP 5xx";
  if (msg.includes("HTTP")) return "HTTP 错误";
  if (msg.includes("Timeout") || msg.includes("AbortError")) return "超时";
  if (msg.includes("fetch failed") || msg.includes("ECONNRESET"))
    return "网络中断";
  if (msg.includes("PARSE")) return "返回非 JSON";
  return msg.slice(0, 24);
}

function RecommendCards({
  tops,
  strategyName,
  playbook,
}: {
  tops: ReturnType<typeof pickTopRecommendations<NonNullable<ScanFormState["results"]>[number]>>;
  strategyName: string;
  playbook: StrategyPlaybook | null;
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
        {tops.map((t, idx) => {
          const trade = computeTradePlan(t.close, strategyName);
          return (
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

            {/* 按当前策略生成的具体买卖参考价 */}
            {trade && (
              <div className="grid grid-cols-3 gap-2 text-xs pt-1">
                <div className="rounded border border-bull/30 bg-bull/5 px-2 py-1.5">
                  <div className="text-ink-mute text-[10px] mb-0.5">买点</div>
                  <div className="font-mono text-bull font-semibold">
                    ≤ {formatNumber(trade.entryMax)}
                  </div>
                  <div className="text-ink-mute text-[10px] mt-0.5">
                    {trade.entryNote}
                  </div>
                </div>
                <div className="rounded border border-bear/30 bg-bear/5 px-2 py-1.5">
                  <div className="text-ink-mute text-[10px] mb-0.5">止损</div>
                  <div className="font-mono text-bear font-semibold">
                    {formatNumber(trade.stopLoss)}
                  </div>
                  <div className="text-ink-mute text-[10px] mt-0.5">
                    {trade.stopNote}
                  </div>
                </div>
                <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
                  <div className="text-ink-mute text-[10px] mb-0.5">分批卖</div>
                  <div className="font-mono text-amber-400 font-semibold">
                    {formatNumber(trade.takeProfit1)}
                    <span className="text-ink-mute"> / </span>
                    {formatNumber(trade.takeProfit2)}
                  </div>
                  <div className="text-ink-mute text-[10px] mt-0.5">
                    {trade.exitNote}
                  </div>
                </div>
              </div>
            )}

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
          );
        })}
      </div>
      {playbook && (
        <div className="px-3 sm:px-4 py-2 border-t border-amber-500/30 text-[11px] text-ink-mute leading-relaxed">
          以上买卖参考价根据「{strategyName}」纪律自动计算；具体止损请配合 K
          线页的均线位置微调。完整操盘手册见上方策略卡。
        </div>
      )}
    </div>
  );
}

/**
 * 根据当前收盘价 + 策略名生成具体买卖参考价位。
 * 设计：返回价格点 + 一句简短中文说明，由 UI 直接展示。
 */
function computeTradePlan(close: number, strategyName: string) {
  if (!Number.isFinite(close) || close <= 0) return null;
  // 同一套基础数据 + 不同策略的纪律差异
  switch (strategyName) {
    case "三指标共振":
      return {
        entryMax: close * 1.01,
        entryNote: "现价 +1% 内追入；高开 >2% 等回踩 5 日线",
        stopLoss: close * 0.93,
        stopNote: "或收盘破 MA20",
        takeProfit1: close * 1.08,
        takeProfit2: close * 1.15,
        exitNote: "+8%/+15% 各减 1/3",
      };
    case "强势缩量回踩":
      return {
        entryMax: close * 1.005,
        entryNote: "收盘站稳 MA20 → 介入；不追高",
        stopLoss: close * 0.97,
        stopNote: "MA20 下方 3% / 放量破 MA20",
        takeProfit1: close * 1.06,
        takeProfit2: close * 1.12,
        exitNote: "放量过前高减半；MA20 破 → 全清",
      };
    case "平台突破":
      return {
        entryMax: close * 1.01,
        entryNote: "突破当日 +1% 内 1/2 仓；次日不破上沿加满",
        stopLoss: close * 0.95,
        stopNote: "跌回平台中位数 -5%",
        takeProfit1: close * 1.15,
        takeProfit2: close * 1.30,
        exitNote: "+15%/+30% 减半；趋势线破清仓",
      };
    case "全指标共振（高胜率）":
      return {
        entryMax: close * 1.01,
        entryNote: "现价 +1% 内介入；高开 >2% 等回踩",
        stopLoss: close * 0.95,
        stopNote: "或收盘破 MA20（更紧的止损）",
        takeProfit1: close * 1.10,
        takeProfit2: close * 1.20,
        exitNote: "+10%/+20% 减仓；MACD/KDJ 高位死叉清仓",
      };
    default:
      // 自定义策略：通用保守参考
      return {
        entryMax: close * 1.01,
        entryNote: "通用：现价 +1% 内",
        stopLoss: close * 0.93,
        stopNote: "通用：-7% 硬止损",
        takeProfit1: close * 1.08,
        takeProfit2: close * 1.15,
        exitNote: "通用：+8%/+15% 分批",
      };
  }
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

/**
 * 策略操盘手册卡：策略选择后展示完整买卖纪律
 */
function PlaybookCard({
  name,
  playbook,
}: {
  name: string;
  playbook: StrategyPlaybook;
}) {
  return (
    <section className="card overflow-hidden border-accent/30">
      <div className="px-3 sm:px-4 py-2 border-b border-accent/30 bg-accent/5 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-ink">📋 操盘手册：{name}</span>
        <span className="badge bg-accent/15 text-accent border border-accent/30 text-xs">
          {playbook.tag}
        </span>
        <span className="badge bg-bg-soft text-ink-soft border border-line text-xs">
          {playbook.position}
        </span>
        <span className="badge bg-bg-soft text-ink-soft border border-line text-xs">
          持有 {playbook.holdPeriod}
        </span>
      </div>
      <div className="p-3 sm:p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="rounded border border-bull/30 bg-bull/5 p-2.5">
          <div className="font-medium text-bull mb-1">🟢 买入时机</div>
          <p className="text-ink-soft leading-relaxed">{playbook.entry}</p>
        </div>
        <div className="rounded border border-bear/30 bg-bear/5 p-2.5">
          <div className="font-medium text-bear mb-1">🔴 止损纪律</div>
          <p className="text-ink-soft leading-relaxed">{playbook.stopLoss}</p>
        </div>
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2.5">
          <div className="font-medium text-amber-400 mb-1">🟡 卖出 / 止盈</div>
          <p className="text-ink-soft leading-relaxed">{playbook.exit}</p>
        </div>
      </div>
      <div className="px-3 sm:px-4 pb-3 sm:pb-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-ink-mute">✓ 适用：</span>
          <span className="text-ink-soft">{playbook.suitFor}</span>
        </div>
        <div>
          <span className="text-ink-mute">✗ 不适用：</span>
          <span className="text-ink-soft">{playbook.avoid}</span>
        </div>
      </div>
    </section>
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

"use client";

import { useState, useTransition } from "react";
import { backtestAction, type BacktestFormState } from "./actions";
import { compactDate, formatPercent } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface Props {
  strategies: Array<{ id: string; name: string }>;
  stockCount: number;
  watchlistCount: number;
}

export default function BacktestForm({
  strategies,
  stockCount,
  watchlistCount,
}: Props) {
  const [strategyId, setStrategyId] = useState(strategies[0]?.id ?? "");
  const [poolType, setPoolType] = useState<"builtin" | "watchlist" | "custom">(
    "builtin"
  );
  const [customCodes, setCustomCodes] = useState("");
  const [startDate, setStartDate] = useState(defaultStartDate());
  const [endDate, setEndDate] = useState(defaultEndDate());
  const [holdDays, setHoldDays] = useState(5);
  const [state, setState] = useState<BacktestFormState | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      setState(null);
      const result = await backtestAction(fd);
      setState(result);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="strategyId" value={strategyId} />
      <input type="hidden" name="poolType" value={poolType} />

      <section className="card p-3 sm:p-4 grid grid-cols-2 md:grid-cols-5 gap-2 sm:gap-3">
        <Field label="策略">
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
        </Field>
        <Field label="股票池">
          <select
            className="input w-full"
            value={poolType}
            onChange={(e) => setPoolType(e.target.value as typeof poolType)}
          >
            <option value="builtin">内置（{stockCount}）</option>
            <option value="watchlist">自选（{watchlistCount}）</option>
            <option value="custom">自定义</option>
          </select>
        </Field>
        <Field label="起始日">
          <input
            name="startDate"
            type="text"
            className="input w-full font-mono"
            placeholder="YYYYMMDD"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Field>
        <Field label="结束日">
          <input
            name="endDate"
            type="text"
            className="input w-full font-mono"
            placeholder="YYYYMMDD"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Field>
        <Field label="持有交易日">
          <input
            name="holdDays"
            type="number"
            min={1}
            max={60}
            className="input w-full"
            value={holdDays}
            onChange={(e) => setHoldDays(Number(e.target.value))}
          />
        </Field>
      </section>

      {poolType === "custom" && (
        <textarea
          name="customCodes"
          rows={3}
          className="input w-full font-mono text-xs"
          placeholder="自定义代码，每行一个"
          value={customCodes}
          onChange={(e) => setCustomCodes(e.target.value)}
        />
      )}

      <button type="submit" className="btn btn-primary" disabled={isPending}>
        {isPending ? "回测中…（耗时较长）" : "开始回测"}
      </button>

      {state && !state.ok && (
        <div className="card p-3 text-sm text-bear border-bear/40">
          {state.message}
        </div>
      )}

      {state?.ok && state.summary && (
        <BacktestResult state={state} />
      )}
    </form>
  );
}

function BacktestResult({ state }: { state: BacktestFormState }) {
  const s = state.summary!;
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 md:grid-cols-5 gap-2 sm:gap-3">
        <Stat label="交易笔数" value={s.totalTrades.toString()} />
        <Stat
          label="胜率"
          value={formatPercent(s.winRate)}
          tone={s.winRate >= 0.5 ? "bull" : "bear"}
        />
        <Stat
          label="平均收益"
          value={formatPercent(s.avgReturn)}
          tone={s.avgReturn >= 0 ? "bull" : "bear"}
        />
        <Stat
          label="累计收益"
          value={formatPercent(s.cumulativeCurve.at(-1)?.cum ?? 0)}
        />
        <Stat
          label="最大回撤"
          value={formatPercent(s.maxDrawdown)}
          tone="bear"
        />
      </section>

      <section className="card p-4">
        <div className="text-sm text-ink-soft mb-3">
          {state.strategyName} · {compactDate(state.startDate ?? "")} ~{" "}
          {compactDate(state.endDate ?? "")} · 股票池 {state.poolSize}
        </div>
        <CurveChart curve={s.cumulativeCurve} />
      </section>

      <section className="card overflow-hidden">
        <div className="px-3 sm:px-4 py-2 border-b border-line text-sm font-medium">
          交易明细（前 200）
        </div>
        <div className="overflow-x-auto table-scroll max-h-[400px]">
          <table className="w-full text-sm min-w-[680px]">
            <thead className="text-ink-soft text-left sticky top-0 bg-bg-card">
              <tr className="border-b border-line">
                <th className="py-2 px-3 sm:px-4 font-medium">代码</th>
                <th className="py-2 px-3 sm:px-4 font-medium">信号日</th>
                <th className="py-2 px-3 sm:px-4 font-medium">买入日/价</th>
                <th className="py-2 px-3 sm:px-4 font-medium">卖出日/价</th>
                <th className="py-2 px-3 sm:px-4 font-medium">收益</th>
              </tr>
            </thead>
            <tbody>
              {s.trades.slice(0, 200).map((t, i) => (
                <tr key={i} className="border-b border-line/50 hover:bg-bg-soft/40">
                  <td className="py-2 px-3 sm:px-4 font-mono whitespace-nowrap">
                    {t.tsCode}
                  </td>
                  <td className="py-2 px-3 sm:px-4 text-ink-soft font-mono whitespace-nowrap">
                    {compactDate(t.signalDate)}
                  </td>
                  <td className="py-2 px-3 sm:px-4 font-mono whitespace-nowrap">
                    {compactDate(t.buyDate)} / {t.buyPrice.toFixed(2)}
                  </td>
                  <td className="py-2 px-3 sm:px-4 font-mono whitespace-nowrap">
                    {compactDate(t.sellDate)} / {t.sellPrice.toFixed(2)}
                  </td>
                  <td
                    className={cn(
                      "py-2 px-3 sm:px-4 font-mono",
                      t.ret >= 0 ? "text-bull" : "text-bear"
                    )}
                  >
                    {formatPercent(t.ret)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function CurveChart({ curve }: { curve: Array<{ date: string; cum: number }> }) {
  if (!curve.length) return <div className="text-ink-mute text-sm">无数据</div>;
  const W = 800;
  const H = 200;
  const min = Math.min(0, ...curve.map((p) => p.cum));
  const max = Math.max(0, ...curve.map((p) => p.cum));
  const range = max - min || 1;

  const points = curve
    .map((p, i) => {
      const x = (i / (curve.length - 1 || 1)) * W;
      const y = H - ((p.cum - min) / range) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const zeroY = H - ((0 - min) / range) * H;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[200px]">
      <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="#3a4456" strokeDasharray="4 4" />
      <polyline
        fill="none"
        stroke="#22c55e"
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs text-ink-soft block mb-1">{label}</label>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "bull" | "bear";
}) {
  return (
    <div className="card p-2.5 sm:p-3">
      <div className="text-[11px] sm:text-xs text-ink-mute mb-1 truncate">
        {label}
      </div>
      <div
        className={cn(
          "text-base sm:text-xl font-semibold font-mono truncate",
          tone === "bull" && "text-bull",
          tone === "bear" && "text-bear"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function defaultStartDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return formatYYYYMMDD(d);
}
function defaultEndDate(): string {
  return formatYYYYMMDD(new Date());
}
function formatYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

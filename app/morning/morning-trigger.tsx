"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerMorningScan } from "@/app/actions/morning-scan";
import type { MorningScanSummary } from "@/lib/scheduled/morning-scan";
import { cn } from "@/lib/utils";

/**
 * 手动触发早间扫描按钮（调试用）
 *
 * 启用时机：建议在 9:25 集合竞价～9:30 开盘之间点击；
 * 也可在盘中任意时间点击重跑——会用最新分时价驱动指标。
 */
export default function MorningTrigger() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<MorningScanSummary | null>(null);

  function onClick() {
    setResult(null);
    startTransition(async () => {
      const r = await triggerMorningScan();
      setResult(r);
      if (r.ok) {
        // 让 server component 重新拉最新 scan run
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="btn btn-primary"
      >
        {pending ? "扫描中…（约 20–60 秒）" : "🚀 立即重跑早间扫描"}
      </button>
      {result && (
        <div
          className={cn(
            "text-xs px-3 py-1.5 rounded border",
            result.ok
              ? "border-bull/40 text-bull bg-bull/5"
              : "border-bear/40 text-bear bg-bear/5"
          )}
        >
          {result.ok ? (
            <>
              ✓ 完成：命中 <b>{result.hitCount}</b>/{result.total} 只 · 失败{" "}
              <b>{result.failedCount}</b> · 耗时 {result.durationMs}ms
            </>
          ) : (
            <>✗ 失败：{result.message}</>
          )}
        </div>
      )}
    </div>
  );
}

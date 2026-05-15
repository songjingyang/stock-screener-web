"use client";

import { useEffect } from "react";

/**
 * 全局错误边界：替换 next.js 默认的 "Application error: a client-side exception"
 * 让 server / client component 抛出的错误信息直接呈现在页面上，便于排查。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);

  return (
    <div className="card p-4 sm:p-6 space-y-3">
      <h1 className="text-lg font-semibold text-bear">页面渲染出错</h1>
      <p className="text-sm text-ink-soft break-words">
        {error.message || "未知错误"}
      </p>
      {error.digest && (
        <p className="text-xs text-ink-mute font-mono">
          digest: {error.digest}
        </p>
      )}
      {error.stack && (
        <pre className="card p-3 text-xs whitespace-pre-wrap break-all overflow-auto max-h-96 bg-bg-muted text-ink-soft">
          {error.stack}
        </pre>
      )}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={() => reset()} className="btn">
          重试
        </button>
        <a href="/" className="btn">
          返回首页
        </a>
      </div>
    </div>
  );
}

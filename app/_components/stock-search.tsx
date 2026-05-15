"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { searchStock, type StockCandidate } from "@/app/actions/search-stock";
import { cn } from "@/lib/utils";

/**
 * 全局个股搜索：导航栏右侧的输入框 + 下拉建议
 *
 * 输入支持：
 *   - 完整 / 部分代码（6 位、600519.SH、sh600519）
 *   - 中文名称模糊（"茅台"、"宁德" 等）
 *   - 数字前缀（如 "6005" → 列出所有以 6005 开头的代码）
 *
 * 选中后跳转 `/stock/[tsCode]`，详情页会自动跑「多策略命中分析」。
 */
export default function StockSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<StockCandidate[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [isPending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 250ms 防抖，避免每个字符都打 server action
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const r = await searchStock(query, 8);
        setResults(r);
        setActiveIdx(0);
      });
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // 点击外部关闭下拉
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function gotoCandidate(c: StockCandidate) {
    setOpen(false);
    setQuery("");
    setResults([]);
    router.push(`/stock/${encodeURIComponent(c.tsCode)}`);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) {
      // 没有候选时，回车直接尝试用 query 当代码跳转
      if (e.key === "Enter" && query.trim()) {
        e.preventDefault();
        startTransition(async () => {
          const r = await searchStock(query, 1);
          if (r.length) gotoCandidate(r[0]);
        });
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      gotoCandidate(results[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative w-44 sm:w-64">
      <input
        type="search"
        className="input w-full text-sm"
        placeholder="搜代码 / 名称 分析个股"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => query && setOpen(true)}
        onKeyDown={onKey}
      />
      {open && (results.length > 0 || isPending) && (
        <div className="absolute left-0 right-0 mt-1 card overflow-hidden shadow-lg z-40 max-h-80 overflow-y-auto">
          {isPending && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-ink-mute">搜索中…</div>
          )}
          {results.map((r, i) => (
            <button
              key={r.tsCode}
              type="button"
              onMouseDown={(e) => {
                // 用 mousedown 抢在 blur 前
                e.preventDefault();
                gotoCandidate(r);
              }}
              onMouseEnter={() => setActiveIdx(i)}
              className={cn(
                "w-full text-left px-3 py-2 flex items-center gap-2 border-b border-line/50 last:border-b-0 hover:bg-bg-muted",
                i === activeIdx && "bg-bg-muted"
              )}
            >
              <span className="font-mono text-xs text-accent">{r.tsCode}</span>
              <span className="text-sm flex-1 truncate">{r.name}</span>
              {r.board && (
                <span className="text-[10px] text-ink-mute hidden sm:inline">
                  {r.board}
                </span>
              )}
              {r.source === "remote" && (
                <span className="text-[10px] text-amber-600" title="该股未入本地库，使用实时报价兜底">
                  实时
                </span>
              )}
            </button>
          ))}
          {!isPending && results.length === 0 && query.trim() && (
            <div className="px-3 py-2 text-xs text-ink-mute">未找到匹配</div>
          )}
        </div>
      )}
    </div>
  );
}

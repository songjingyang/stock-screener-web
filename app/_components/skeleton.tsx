/**
 * 通用骨架占位（loading.tsx 用）
 *
 * 设计：默认带 animate-pulse；类名可叠加来定制宽高、圆角。
 * 在导航切换瞬间立即显示，让 server component 的慢 IO 隐藏到背景。
 */
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-bg-soft/60 border border-line/40",
        className
      )}
    />
  );
}

/** 标题 + 副标题骨架（页面顶部用） */
export function PageHeaderSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-72" />
    </div>
  );
}

/** 卡片骨架（带圆角和高度） */
export function CardSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn("rounded-xl", className)} />;
}

/** 表格行骨架 */
export function TableRowsSkeleton({
  rows = 6,
  cols = 6,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

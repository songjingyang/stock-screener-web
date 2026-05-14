import {
  PageHeaderSkeleton,
  CardSkeleton,
  TableRowsSkeleton,
} from "./_components/skeleton";

/**
 * 兜底 loading：导航切换瞬间立即显示，避免「卡半天才切过去」
 */
export default function Loading() {
  return (
    <div className="space-y-4">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CardSkeleton className="h-24" />
        <CardSkeleton className="h-24" />
        <CardSkeleton className="h-24" />
        <CardSkeleton className="h-24" />
      </div>
      <div className="card overflow-hidden">
        <TableRowsSkeleton rows={6} cols={6} />
      </div>
    </div>
  );
}

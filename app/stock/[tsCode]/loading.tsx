import {
  PageHeaderSkeleton,
  CardSkeleton,
  Skeleton,
} from "../../_components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <PageHeaderSkeleton />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <CardSkeleton className="h-[300px] sm:h-[480px]" />
        <CardSkeleton className="h-[480px]" />
      </div>
      <CardSkeleton className="h-72" />
    </div>
  );
}

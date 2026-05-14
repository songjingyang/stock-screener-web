import {
  PageHeaderSkeleton,
  CardSkeleton,
  Skeleton,
} from "../_components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <PageHeaderSkeleton />
        <Skeleton className="h-9 w-44" />
      </div>
      <CardSkeleton className="h-12" />
      <div className="card overflow-hidden">
        <Skeleton className="h-8 m-0 rounded-none border-0 border-b border-line" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 p-3">
          <CardSkeleton className="h-44" />
          <CardSkeleton className="h-44" />
          <CardSkeleton className="h-44" />
        </div>
      </div>
    </div>
  );
}

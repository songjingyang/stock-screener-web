import {
  PageHeaderSkeleton,
  CardSkeleton,
  Skeleton,
} from "../_components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <PageHeaderSkeleton />
      <CardSkeleton className="h-32" />
      <CardSkeleton className="h-20" />
      <CardSkeleton className="h-48" />
      <div className="flex gap-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
      </div>
    </div>
  );
}

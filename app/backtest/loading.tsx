import {
  PageHeaderSkeleton,
  CardSkeleton,
} from "../_components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <PageHeaderSkeleton />
      <CardSkeleton className="h-40" />
      <CardSkeleton className="h-72" />
    </div>
  );
}

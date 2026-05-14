import {
  PageHeaderSkeleton,
  CardSkeleton,
  TableRowsSkeleton,
} from "../_components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CardSkeleton className="h-36" />
        <CardSkeleton className="h-36" />
        <CardSkeleton className="h-36" />
        <CardSkeleton className="h-36" />
      </div>
      <div className="card overflow-hidden">
        <TableRowsSkeleton rows={10} cols={9} />
      </div>
    </div>
  );
}

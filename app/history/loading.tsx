import {
  PageHeaderSkeleton,
  TableRowsSkeleton,
} from "../_components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <PageHeaderSkeleton />
      <div className="card overflow-hidden">
        <TableRowsSkeleton rows={10} cols={6} />
      </div>
    </div>
  );
}

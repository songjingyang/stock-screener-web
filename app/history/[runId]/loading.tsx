import {
  PageHeaderSkeleton,
  TableRowsSkeleton,
} from "../../_components/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <PageHeaderSkeleton />
      <div className="card overflow-hidden">
        <TableRowsSkeleton rows={12} cols={8} />
      </div>
    </div>
  );
}

"use client";

import { useTransition } from "react";
import { removeWatchlist } from "./actions";

export default function RemoveButton({ tsCode }: { tsCode: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="text-bear hover:underline text-xs disabled:opacity-50"
      disabled={isPending}
      onClick={() => startTransition(() => removeWatchlist(tsCode))}
    >
      移除
    </button>
  );
}

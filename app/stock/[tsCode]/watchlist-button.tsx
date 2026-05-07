"use client";

import { useState, useTransition } from "react";
import { toggleWatchlist } from "@/app/watchlist/actions";

export default function WatchlistButton({
  tsCode,
  initialIn,
}: {
  tsCode: string;
  initialIn: boolean;
}) {
  const [inWatch, setInWatch] = useState(initialIn);
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="btn"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const next = await toggleWatchlist(tsCode);
          setInWatch(next.inWatchlist);
        });
      }}
    >
      {inWatch ? "★ 已加自选" : "☆ 加入自选"}
    </button>
  );
}

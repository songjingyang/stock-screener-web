"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

interface Props {
  currentId: string;
  strategies: Array<{ id: string; name: string }>;
}

export default function StrategySelect({ currentId, strategies }: Props) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();

  return (
    <select
      value={currentId}
      onChange={(e) => {
        const params = new URLSearchParams(sp.toString());
        params.set("strategy", e.target.value);
        router.replace(`${path}?${params.toString()}`);
      }}
      className="input w-full"
    >
      {strategies.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

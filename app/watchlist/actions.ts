"use server";

import { prisma } from "@/lib/db/prisma";
import { revalidatePath } from "next/cache";

export async function toggleWatchlist(
  tsCode: string
): Promise<{ inWatchlist: boolean }> {
  const exist = await prisma.watchlist.findUnique({ where: { tsCode } });
  if (exist) {
    await prisma.watchlist.delete({ where: { tsCode } });
    revalidatePath("/watchlist");
    return { inWatchlist: false };
  }
  await prisma.watchlist.create({ data: { tsCode } });
  revalidatePath("/watchlist");
  return { inWatchlist: true };
}

export async function removeWatchlist(tsCode: string): Promise<void> {
  await prisma.watchlist.delete({ where: { tsCode } }).catch(() => {});
  revalidatePath("/watchlist");
}

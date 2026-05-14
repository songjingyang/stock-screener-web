"use server";

import { revalidatePath } from "next/cache";
import { runMorningScan, type MorningScanSummary } from "@/lib/scheduled/morning-scan";

/**
 * 手动触发早间开盘扫描（调试用）
 *
 * 与定时 cron 同一份逻辑：全 A 股 + 全指标共振 + 实时合并 + 落库
 * 完成后 revalidate `/morning` 与 `/history`，让前端立即看到新结果
 */
export async function triggerMorningScan(): Promise<MorningScanSummary> {
  const r = await runMorningScan();
  if (r.ok) {
    revalidatePath("/morning");
    revalidatePath("/history");
  }
  return r;
}

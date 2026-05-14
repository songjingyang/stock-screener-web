/**
 * 开盘前自动扫描（09:25 集合竞价时段）
 *
 * 设计要点：
 *   1) 只跑「全指标共振（高胜率）」一条策略 —— 9:25 时段最关心确定性最高的推荐
 *   2) 强制走缓存（warmup cron 凌晨已把 K 线灌满）+ 实时合并集合竞价价
 *   3) 结果落库到 ScanRun，前端 /morning 直接读最近一条
 *
 * 注意：runScan 内部按 strategyId 取 K 线、跑评估、可选落库。
 *      morning-scan 走 persist:true，可以在 /history 看完整明细。
 */
import { prisma } from "@/lib/db/prisma";
import { runScan } from "@/lib/screener/runner";

/** 早间扫描指定使用的策略名（与 BUILTIN_STRATEGIES 一致） */
const PREFERRED_STRATEGY_NAME = "全指标共振（高胜率）";

export interface MorningScanSummary {
  ok: boolean;
  message?: string;
  scanRunId?: string;
  strategyId?: string;
  strategyName?: string;
  scanDate?: string;
  hitCount?: number;
  total?: number;
  failedCount?: number;
  durationMs?: number;
}

export async function runMorningScan(): Promise<MorningScanSummary> {
  const t0 = Date.now();
  try {
    // 1) 选取策略：优先全指标共振，缺失则取第一个内置策略
    const strategy =
      (await prisma.strategy.findFirst({
        where: { name: PREFERRED_STRATEGY_NAME },
      })) ??
      (await prisma.strategy.findFirst({
        orderBy: { createdAt: "asc" },
      }));
    if (!strategy) {
      return { ok: false, message: "无可用策略，请先运行 seed" };
    }

    // 2) 拉全 A 股 tsCode
    const stocks = await prisma.stock.findMany({ select: { tsCode: true } });
    const tsCodes = stocks.map((s) => s.tsCode);
    if (tsCodes.length < 200) {
      return {
        ok: false,
        message: `股票池太小（${tsCodes.length} 只），请先同步全 A 股`,
      };
    }

    // 3) 跑扫描：缓存 + 实时合并（集合竞价价驱动指标）+ 落库
    const out = await runScan({
      strategyId: strategy.id,
      tsCodes,
      persist: true,
      forceRefresh: false, // 凌晨 warmup 已经填好缓存，无需再拉一次日 K
      mergeRealtime: true, // 9:25 集合竞价时段腾讯 quote 接口已经能取到当日集合竞价价
    });

    return {
      ok: true,
      scanRunId: out.scanRunId,
      strategyId: strategy.id,
      strategyName: strategy.name,
      scanDate: out.scanDate,
      hitCount: out.hitCount,
      total: out.total,
      failedCount: out.failed.length,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      ok: false,
      message: (err as Error).message,
      durationMs: Date.now() - t0,
    };
  }
}

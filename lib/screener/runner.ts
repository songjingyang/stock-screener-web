/**
 * 扫描运行器：组合 K 线缓存 + 规则引擎，对一批股票进行评估并落库。
 */
import { prisma } from "@/lib/db/prisma";
import { getKlineBatch, toCalDate } from "@/lib/data/kline-cache";
import { evaluate, type RuleConfig } from "./rule-engine";
import { sortByScoreDesc, type ScoredItem } from "./scoring";

export interface ScanInput {
  strategyId: string;
  tsCodes: string[];
  /** 是否将本次扫描结果落库为一条 ScanRun */
  persist?: boolean;
  /** 是否强制重拉今日 K 线（绕过 shouldFetch 智能判断） */
  forceRefresh?: boolean;
}

/** 失败原因分类，便于前端分组展示 */
export type FailReason =
  | "no_kline" /* 远端拉取失败 / 接口返回空 */
  | "insufficient" /* K 线不足 70 根，指标无法计算（新股 / 长停牌 / 退市） */
  | "evaluate_error"; /* 规则引擎抛错或返回 null */

export interface FailedItem {
  tsCode: string;
  reason: FailReason;
  /** K 线条数（用于排查；no_kline 时为 0） */
  klineCount: number;
  /** 远端接口的错误 message（仅 no_kline 时可能存在） */
  errorMessage?: string;
}

export interface ScanOutput {
  scanRunId?: string;
  scanDate: string;
  total: number;
  hitCount: number;
  items: ScoredItem[];
  /** 仅保留 tsCode 兼容旧调用，详细分类见 failedDetail */
  failed: string[];
  failedDetail: FailedItem[];
}

export async function runScan(input: ScanInput): Promise<ScanOutput> {
  const strategy = await prisma.strategy.findUnique({
    where: { id: input.strategyId },
  });
  if (!strategy) throw new Error(`策略不存在: ${input.strategyId}`);

  const ruleConfig = JSON.parse(strategy.ruleConfig) as RuleConfig;

  // 取一次股票名映射，方便填充
  const stocks = await prisma.stock.findMany({
    where: { tsCode: { in: input.tsCodes } },
  });
  const stockMap = new Map(stocks.map((s) => [s.tsCode, s]));

  // 拉 K 线（扫描全市场时打印进度，方便观察）
  const verbose = input.tsCodes.length > 200;
  const t0 = Date.now();
  const { data: klineMap, errors: klineErrors } = await getKlineBatch(
    input.tsCodes,
    { lookbackDays: 400, forceRefresh: !!input.forceRefresh },
    (done, total) => {
      if (verbose && (done % 200 === 0 || done === total)) {
        const rate = ((done / total) * 100).toFixed(1);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`[scan] ${done}/${total} (${rate}%) · ${elapsed}s`);
      }
    }
  );

  const items: ScoredItem[] = [];
  const failedDetail: FailedItem[] = [];

  for (const tsCode of input.tsCodes) {
    const k = klineMap.get(tsCode) ?? [];
    if (k.length === 0) {
      failedDetail.push({
        tsCode,
        reason: "no_kline",
        klineCount: 0,
        errorMessage: klineErrors.get(tsCode),
      });
      continue;
    }
    if (k.length < 70) {
      failedDetail.push({ tsCode, reason: "insufficient", klineCount: k.length });
      continue;
    }
    const result = evaluate(k, ruleConfig);
    if (!result) {
      failedDetail.push({
        tsCode,
        reason: "evaluate_error",
        klineCount: k.length,
      });
      continue;
    }
    const stock = stockMap.get(tsCode);
    // 取最近 30 个交易日收盘价用于绘制迷你走势图（约 6 个交易周）
    const recentCloses = k.slice(-30).map((bar) => bar.close);
    items.push({
      tsCode,
      name: stock?.name,
      industry: stock?.industry ?? undefined,
      board: stock?.board ?? undefined,
      recentCloses,
      result,
    });
  }

  const sorted = sortByScoreDesc(items);
  const hits = sorted.filter((s) => s.result.pass);
  const scanDate = items[0]?.result.context.date ?? toCalDate();

  let scanRunId: string | undefined;
  if (input.persist) {
    const run = await prisma.scanRun.create({
      data: {
        strategyId: input.strategyId,
        scanDate,
        hitCount: hits.length,
        totalCount: input.tsCodes.length,
        results: {
          create: sorted.map((s) => ({
            tsCode: s.tsCode,
            score: s.result.score,
            pass: s.result.pass,
            detail: JSON.stringify({
              context: s.result.context,
              conditions: s.result.conditions,
            }),
          })),
        },
      },
    });
    scanRunId = run.id;
  }

  return {
    scanRunId,
    scanDate,
    total: input.tsCodes.length,
    hitCount: hits.length,
    items: sorted,
    failed: failedDetail.map((f) => f.tsCode),
    failedDetail,
  };
}

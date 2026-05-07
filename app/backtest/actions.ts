"use server";

import { prisma } from "@/lib/db/prisma";
import { getKlineBatch, toCalDate } from "@/lib/data/kline-cache";
import {
  backtestSingle,
  summarize,
  type BacktestSummary,
} from "@/lib/backtest/runner";
import type { RuleConfig } from "@/lib/screener/rule-engine";
import { toTsCode } from "@/lib/data/universe";

export interface BacktestFormState {
  ok: boolean;
  message?: string;
  summary?: BacktestSummary;
  startDate?: string;
  endDate?: string;
  strategyName?: string;
  poolSize?: number;
}

export async function backtestAction(
  formData: FormData
): Promise<BacktestFormState> {
  const strategyId = formData.get("strategyId") as string;
  const poolType = formData.get("poolType") as string;
  const customCodes = (formData.get("customCodes") as string) ?? "";
  const startDate = (formData.get("startDate") as string) || "";
  const endDate = (formData.get("endDate") as string) || toCalDate();
  const holdDays = Number(formData.get("holdDays") ?? 5);

  if (!strategyId || !startDate) {
    return { ok: false, message: "请填写完整参数" };
  }

  const strategy = await prisma.strategy.findUnique({
    where: { id: strategyId },
  });
  if (!strategy) return { ok: false, message: "策略不存在" };
  const ruleConfig = JSON.parse(strategy.ruleConfig) as RuleConfig;

  let tsCodes: string[] = [];
  if (poolType === "builtin") {
    const list = await prisma.stock.findMany({ select: { tsCode: true } });
    tsCodes = list.map((s) => s.tsCode);
  } else if (poolType === "watchlist") {
    const list = await prisma.watchlist.findMany({ select: { tsCode: true } });
    tsCodes = list.map((w) => w.tsCode);
  } else if (poolType === "custom") {
    const set = new Set<string>();
    for (const ln of customCodes.split(/[\s,，;；]+/)) {
      const c = toTsCode(ln);
      if (c) set.add(c);
    }
    tsCodes = Array.from(set);
  }
  if (!tsCodes.length) return { ok: false, message: "股票池为空" };

  // 至少多取 100 个交易日，保证 startDate 之前有指标计算空间
  const lookbackDays = Math.max(
    400,
    diffDaysYYYYMMDD(startDate, endDate) + 200
  );
  const klineMap = await getKlineBatch(tsCodes, lookbackDays);

  const results = tsCodes.map((code) => {
    const k = klineMap.get(code) ?? [];
    return backtestSingle(code, k, ruleConfig, {
      startDate,
      endDate,
      holdDays,
    });
  });

  const summary = summarize(results);
  return {
    ok: true,
    summary,
    startDate,
    endDate,
    strategyName: strategy.name,
    poolSize: tsCodes.length,
  };
}

function diffDaysYYYYMMDD(a: string, b: string): number {
  const ay = Number(a.slice(0, 4));
  const am = Number(a.slice(4, 6)) - 1;
  const ad = Number(a.slice(6, 8));
  const by = Number(b.slice(0, 4));
  const bm = Number(b.slice(4, 6)) - 1;
  const bd = Number(b.slice(6, 8));
  const da = new Date(ay, am, ad).getTime();
  const db = new Date(by, bm, bd).getTime();
  return Math.max(0, Math.round((db - da) / 86400000));
}

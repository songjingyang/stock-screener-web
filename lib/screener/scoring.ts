/**
 * 命中结果排序辅助
 */
import type { EvaluateResult } from "./rule-engine";

export interface ScoredItem {
  tsCode: string;
  name?: string;
  industry?: string;
  board?: string;
  /** 最近 N 个交易日的收盘价（按日期升序），用于 UI 绘制迷你走势图 */
  recentCloses?: number[];
  result: EvaluateResult;
}

export function sortByScoreDesc(items: ScoredItem[]): ScoredItem[] {
  return [...items].sort((a, b) => {
    if (a.result.pass !== b.result.pass) return a.result.pass ? -1 : 1;
    if (b.result.score !== a.result.score) return b.result.score - a.result.score;
    return a.tsCode.localeCompare(b.tsCode);
  });
}

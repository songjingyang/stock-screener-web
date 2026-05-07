/**
 * 量比 / 缩量等量价指标
 * 来源：从 stock-screener-ext/src/indicators.js 迁移
 */
import { sma } from "./ma";

/**
 * 量比：当日成交量 / 前 N 日平均成交量（不含当日）
 */
export function volumeRatio(volumes: number[], period = 5): Array<number | null> {
  const avg = sma(volumes, period);
  return volumes.map((v, i) => {
    if (i === 0 || avg[i - 1] == null || avg[i - 1] === 0) return null;
    return v / (avg[i - 1] as number);
  });
}

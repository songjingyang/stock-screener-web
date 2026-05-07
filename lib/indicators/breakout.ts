/**
 * 突破类指标：N 日新高 / 平台突破
 * - rollingHigh：从 indicators.js 迁移（前 N 日最高，不含当 bar）
 * - platformBreakout：识别"前 N 日窄幅整理后放量突破"形态
 */

/**
 * 滚动最高（不含当前 bar 的前 period 日最高）
 */
export function rollingHigh(highs: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(highs.length).fill(null);
  for (let i = period; i < highs.length; i++) {
    let mx = -Infinity;
    for (let j = i - period; j < i; j++) {
      if (highs[j] > mx) mx = highs[j];
    }
    out[i] = mx;
  }
  return out;
}

/**
 * 平台突破识别
 * 条件：
 *   - 前 lookback 日（不含当日）收盘价振幅 (max-min)/min < bandThreshold
 *   - 当日收盘 > 前 lookback 日最高
 * 返回：与 closes 等长的布尔序列
 */
export function platformBreakout(
  closes: number[],
  highs: number[],
  lookback = 20,
  bandThreshold = 0.08
): boolean[] {
  const out = new Array(closes.length).fill(false);
  for (let i = lookback; i < closes.length; i++) {
    let max = -Infinity;
    let min = Infinity;
    let maxHigh = -Infinity;
    for (let p = i - lookback; p < i; p++) {
      if (closes[p] > max) max = closes[p];
      if (closes[p] < min) min = closes[p];
      if (highs[p] > maxHigh) maxHigh = highs[p];
    }
    if (min <= 0) continue;
    const band = (max - min) / min;
    if (band < bandThreshold && closes[i] > maxHigh) {
      out[i] = true;
    }
  }
  return out;
}

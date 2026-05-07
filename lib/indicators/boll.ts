/**
 * 布林带 BOLL（默认 N=20, k=2）
 * mid = SMA(close, N)
 * std = sqrt(sum((close[i] - mid)^2) / N)
 * upper = mid + k*std, lower = mid - k*std
 */
export interface BollResult {
  mid: Array<number | null>;
  upper: Array<number | null>;
  lower: Array<number | null>;
  bandwidth: Array<number | null>; // (upper - lower) / mid，用于平台/收敛识别
}

export function boll(closes: number[], period = 20, k = 2): BollResult {
  const len = closes.length;
  const mid: Array<number | null> = new Array(len).fill(null);
  const upper: Array<number | null> = new Array(len).fill(null);
  const lower: Array<number | null> = new Array(len).fill(null);
  const bandwidth: Array<number | null> = new Array(len).fill(null);

  if (len < period) return { mid, upper, lower, bandwidth };

  for (let i = period - 1; i < len; i++) {
    let sum = 0;
    for (let p = i - period + 1; p <= i; p++) sum += closes[p];
    const m = sum / period;
    let sq = 0;
    for (let p = i - period + 1; p <= i; p++) sq += (closes[p] - m) ** 2;
    const std = Math.sqrt(sq / period);
    mid[i] = m;
    upper[i] = m + k * std;
    lower[i] = m - k * std;
    bandwidth[i] = m === 0 ? null : ((upper[i] as number) - (lower[i] as number)) / m;
  }
  return { mid, upper, lower, bandwidth };
}

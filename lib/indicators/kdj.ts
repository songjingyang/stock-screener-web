/**
 * KDJ 随机指标（同花顺/通达信参数 9/3/3）
 * 计算：
 *   RSV(n) = (close - lowest(n)) / (highest(n) - lowest(n)) * 100
 *   K = SMA(RSV, m1) 用 1/m1 平滑：K = (m1-1)/m1 * K_prev + 1/m1 * RSV
 *   D = SMA(K,   m2) 同上
 *   J = 3K - 2D
 */
export interface KDJResult {
  k: Array<number | null>;
  d: Array<number | null>;
  j: Array<number | null>;
}

export function kdj(
  highs: number[],
  lows: number[],
  closes: number[],
  n = 9,
  m1 = 3,
  m2 = 3
): KDJResult {
  const len = closes.length;
  const k: Array<number | null> = new Array(len).fill(null);
  const d: Array<number | null> = new Array(len).fill(null);
  const j: Array<number | null> = new Array(len).fill(null);

  let prevK = 50;
  let prevD = 50;

  for (let i = 0; i < len; i++) {
    if (i < n - 1) continue;
    let hi = -Infinity;
    let lo = Infinity;
    for (let p = i - n + 1; p <= i; p++) {
      if (highs[p] > hi) hi = highs[p];
      if (lows[p] < lo) lo = lows[p];
    }
    const range = hi - lo;
    const rsv = range === 0 ? 50 : ((closes[i] - lo) / range) * 100;
    const ki = ((m1 - 1) / m1) * prevK + (1 / m1) * rsv;
    const di = ((m2 - 1) / m2) * prevD + (1 / m2) * ki;
    k[i] = ki;
    d[i] = di;
    j[i] = 3 * ki - 2 * di;
    prevK = ki;
    prevD = di;
  }
  return { k, d, j };
}

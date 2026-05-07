/**
 * ATR（平均真实波幅，Wilder 平滑）
 * TR = max(high-low, |high-close_prev|, |low-close_prev|)
 * ATR(n) = (ATR_prev*(n-1) + TR) / n
 */
export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): Array<number | null> {
  const len = closes.length;
  const out: Array<number | null> = new Array(len).fill(null);
  if (len <= period) return out;

  const trs: number[] = new Array(len).fill(0);
  trs[0] = highs[0] - lows[0];
  for (let i = 1; i < len; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs[i] = tr;
  }

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trs[i];
  out[period] = sum / period;

  for (let i = period + 1; i < len; i++) {
    out[i] = ((out[i - 1] as number) * (period - 1) + trs[i]) / period;
  }
  return out;
}

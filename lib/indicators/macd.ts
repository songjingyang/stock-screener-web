/**
 * MACD（标准参数 12/26/9）
 * 与原 indicators.js 保持一致：HIST 乘 2（通达信/同花顺习惯）
 */
import { ema } from "./ma";

export interface MACDResult {
  dif: Array<number | null>;
  dea: Array<number | null>;
  hist: Array<number | null>;
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9
): MACDResult {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const dif: Array<number | null> = closes.map((_, i) => {
    if (emaFast[i] == null || emaSlow[i] == null) return null;
    return (emaFast[i] as number) - (emaSlow[i] as number);
  });
  const validStart = dif.findIndex((v) => v != null);
  const dea: Array<number | null> = new Array(closes.length).fill(null);
  if (validStart !== -1) {
    const difTail = dif.slice(validStart).map((v) => v ?? 0);
    const deaTail = ema(difTail, signal);
    for (let i = 0; i < deaTail.length; i++) {
      dea[validStart + i] = deaTail[i];
    }
  }
  const hist: Array<number | null> = dif.map((v, i) => {
    if (v == null || dea[i] == null) return null;
    return (v - (dea[i] as number)) * 2;
  });
  return { dif, dea, hist };
}

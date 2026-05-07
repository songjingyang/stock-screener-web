/**
 * 均线指标：SMA / EMA
 * 来源：从 stock-screener-ext/src/indicators.js 迁移并加 TS 类型，逻辑零改动
 */

/**
 * 简单移动平均
 * @returns 与 values 等长，前 period-1 个为 null
 */
export function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period];
    out[i] = sum / period;
  }
  return out;
}

/**
 * 指数移动平均（金融界通用：α = 2/(N+1)，首值用首个原始值初始化）
 */
export function ema(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (!values.length) return out;
  const alpha = 2 / (period + 1);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    out[i] = values[i] * alpha + (out[i - 1] as number) * (1 - alpha);
  }
  return out;
}

/**
 * 通用规则引擎：把 K 线 + 规则 DSL 评估为命中详情
 *
 * SOLID:
 *   - 单一职责：仅对单只股票求值，不关心数据来源
 *   - 开放封闭：新增条件类型只需在 evaluators 中加一项
 */
import {
  sma,
  macd,
  rsi,
  kdj,
  atr,
  volumeRatio,
  rollingHigh,
  platformBreakout,
} from "@/lib/indicators";
import type { KLine } from "@/lib/data/kline-cache";

// ============================================================================
// DSL 定义
// ============================================================================

export type RuleCondition =
  | { type: "ma_bull"; periods: number[] }
  | { type: "ma_slope_up"; period: number; lookback: number }
  | { type: "ma_not_down"; period: number; lookback: number }
  | { type: "macd_above_zero" }
  | { type: "macd_golden"; window: number }
  | { type: "rsi_in"; period: number; min: number; max: number }
  | { type: "kdj_golden"; window: number; n?: number; m1?: number; m2?: number }
  | { type: "vol_ratio_gte"; ratio: number; base: number }
  | { type: "vol_shrink_pullback"; base: number; ratioLt: number; maPeriod: number }
  | { type: "break_n_high"; period: number }
  | { type: "platform_breakout"; lookback: number; band: number }
  | { type: "atr_pct_in"; period: number; min: number; max: number };

export interface RuleConfig {
  name?: string;
  conditions: RuleCondition[];
  logic: "AND" | "OR";
  /** 各条件评分权重（默认每个 1 分） */
  weights?: Record<string, number>;
}

export interface ConditionResult {
  type: RuleCondition["type"];
  label: string;
  pass: boolean;
  detail?: Record<string, number | string | null>;
}

export interface EvaluateResult {
  pass: boolean;
  score: number;
  maxScore: number;
  conditions: ConditionResult[];
  context: {
    date: string;
    close: number;
    ma: Record<string, number | null>;
    macd: { dif: number | null; dea: number | null; hist: number | null };
    rsi14: number | null;
    kdj: { k: number | null; d: number | null; j: number | null };
    volRatio: number | null;
    atrPct: number | null;
  };
}

// ============================================================================
// 单条件求值
// ============================================================================

interface Ctx {
  kline: KLine[];
  closes: number[];
  highs: number[];
  lows: number[];
  vols: number[];
  last: number;
}

function evalCondition(cond: RuleCondition, ctx: Ctx): ConditionResult {
  const { closes, highs, lows, vols, last } = ctx;

  switch (cond.type) {
    case "ma_bull": {
      const periods = [...cond.periods].sort((a, b) => a - b); // 5,10,20,60
      const values = periods.map((p) => sma(closes, p)[last]);
      const allReady = values.every((v) => v != null);
      // 短期均线 > 长期均线 → 多头排列
      let pass = allReady;
      if (allReady) {
        for (let i = 1; i < values.length; i++) {
          if ((values[i - 1] as number) <= (values[i] as number)) {
            pass = false;
            break;
          }
        }
      }
      const detail: Record<string, number | null> = {};
      periods.forEach((p, i) => (detail[`MA${p}`] = values[i]));
      return {
        type: cond.type,
        label: `均线多头(${periods.join(">")})`,
        pass,
        detail,
      };
    }

    case "ma_slope_up": {
      const arr = sma(closes, cond.period);
      const cur = arr[last];
      const prev = arr[last - cond.lookback];
      const pass = cur != null && prev != null && cur > prev;
      return {
        type: cond.type,
        label: `MA${cond.period}向上(${cond.lookback}日前)`,
        pass,
        detail: { current: cur, prev },
      };
    }

    case "ma_not_down": {
      const arr = sma(closes, cond.period);
      const cur = arr[last];
      const prev = arr[last - cond.lookback];
      const pass = cur != null && prev != null && cur >= prev;
      return {
        type: cond.type,
        label: `MA${cond.period}非下行(${cond.lookback}日)`,
        pass,
        detail: { current: cur, prev },
      };
    }

    case "macd_above_zero": {
      const { dif } = macd(closes);
      const v = dif[last];
      return {
        type: cond.type,
        label: "DIF > 0",
        pass: v != null && v > 0,
        detail: { dif: v },
      };
    }

    case "macd_golden": {
      const { dif, dea } = macd(closes);
      let golden = false;
      let crossDate: string | null = null;
      for (let i = last; i >= last - cond.window + 1 && i > 0; i--) {
        const d1 = dif[i];
        const d2 = dif[i - 1];
        const e1 = dea[i];
        const e2 = dea[i - 1];
        if (d1 == null || d2 == null || e1 == null || e2 == null) continue;
        const cur = d1 - e1;
        const prev = d2 - e2;
        if (prev <= 0 && cur > 0) {
          golden = true;
          crossDate = ctx.kline[i].date;
          break;
        }
      }
      return {
        type: cond.type,
        label: `${cond.window}日内 MACD 金叉`,
        pass: golden,
        detail: { crossDate },
      };
    }

    case "rsi_in": {
      const r = rsi(closes, cond.period);
      const v = r[last];
      const pass = v != null && v >= cond.min && v <= cond.max;
      return {
        type: cond.type,
        label: `RSI${cond.period} ∈ [${cond.min},${cond.max}]`,
        pass,
        detail: { rsi: v },
      };
    }

    case "kdj_golden": {
      const n = cond.n ?? 9;
      const m1 = cond.m1 ?? 3;
      const m2 = cond.m2 ?? 3;
      const { k, d } = kdj(highs, lows, closes, n, m1, m2);
      let golden = false;
      for (let i = last; i >= last - cond.window + 1 && i > 0; i--) {
        const k1 = k[i];
        const k2 = k[i - 1];
        const d1 = d[i];
        const d2 = d[i - 1];
        if (k1 == null || k2 == null || d1 == null || d2 == null) continue;
        if (k2 <= d2 && k1 > d1) {
          golden = true;
          break;
        }
      }
      return {
        type: cond.type,
        label: `${cond.window}日内 KDJ 金叉`,
        pass: golden,
        detail: { K: k[last], D: d[last] },
      };
    }

    case "vol_ratio_gte": {
      const vr = volumeRatio(vols, cond.base)[last];
      const pass = vr != null && vr >= cond.ratio;
      return {
        type: cond.type,
        label: `量比 ≥ ${cond.ratio}（基准${cond.base}日）`,
        pass,
        detail: { ratio: vr },
      };
    }

    case "vol_shrink_pullback": {
      // 缩量回踩：当日量比 < ratioLt 且收盘价 ≥ MA(maPeriod) 且 当日 low ≤ MA(maPeriod)
      const vr = volumeRatio(vols, cond.base)[last];
      const ma = sma(closes, cond.maPeriod)[last];
      const lo = lows[last];
      const close = closes[last];
      const pass =
        vr != null &&
        ma != null &&
        vr < cond.ratioLt &&
        close >= ma &&
        lo <= ma;
      return {
        type: cond.type,
        label: `缩量回踩 MA${cond.maPeriod}`,
        pass,
        detail: { volRatio: vr, ma, low: lo, close },
      };
    }

    case "break_n_high": {
      const arr = rollingHigh(highs, cond.period);
      const prevHigh = arr[last];
      const close = closes[last];
      const pass = prevHigh != null && close > prevHigh;
      return {
        type: cond.type,
        label: `突破前 ${cond.period} 日新高`,
        pass,
        detail: { prevHigh, close },
      };
    }

    case "platform_breakout": {
      const flags = platformBreakout(closes, highs, cond.lookback, cond.band);
      return {
        type: cond.type,
        label: `平台突破(${cond.lookback}/${(cond.band * 100).toFixed(0)}%)`,
        pass: !!flags[last],
      };
    }

    case "atr_pct_in": {
      const arr = atr(highs, lows, closes, cond.period);
      const v = arr[last];
      const close = closes[last];
      const ratio = v != null && close > 0 ? v / close : null;
      const pass =
        ratio != null && ratio >= cond.min && ratio <= cond.max;
      return {
        type: cond.type,
        label: `ATR/价 ∈ [${(cond.min * 100).toFixed(1)}%,${(cond.max * 100).toFixed(1)}%]`,
        pass,
        detail: { atr: v, ratio },
      };
    }
  }
}

// ============================================================================
// 整体求值
// ============================================================================

export function evaluate(
  kline: KLine[],
  rule: RuleConfig
): EvaluateResult | null {
  if (!kline || kline.length < 70) {
    // 60 日均线 + 缓冲
    return null;
  }

  const closes = kline.map((k) => k.close);
  const highs = kline.map((k) => k.high);
  const lows = kline.map((k) => k.low);
  const vols = kline.map((k) => k.vol);
  const last = kline.length - 1;
  const ctx: Ctx = { kline, closes, highs, lows, vols, last };

  const condResults = rule.conditions.map((c) => evalCondition(c, ctx));

  let score = 0;
  let maxScore = 0;
  for (const r of condResults) {
    const w = rule.weights?.[r.type] ?? 1;
    maxScore += w;
    if (r.pass) score += w;
  }

  const pass =
    rule.logic === "AND"
      ? condResults.every((r) => r.pass)
      : condResults.some((r) => r.pass);

  // 上下文快照（供 UI 展示）
  const ma5 = sma(closes, 5)[last];
  const ma10 = sma(closes, 10)[last];
  const ma20 = sma(closes, 20)[last];
  const ma60 = sma(closes, 60)[last];
  const macdRes = macd(closes);
  const rsi14 = rsi(closes, 14)[last];
  const kdjRes = kdj(highs, lows, closes);
  const vr = volumeRatio(vols, 5)[last];
  const atr14 = atr(highs, lows, closes, 14)[last];

  return {
    pass,
    score,
    maxScore,
    conditions: condResults,
    context: {
      date: kline[last].date,
      close: closes[last],
      ma: { MA5: ma5, MA10: ma10, MA20: ma20, MA60: ma60 },
      macd: {
        dif: macdRes.dif[last],
        dea: macdRes.dea[last],
        hist: macdRes.hist[last],
      },
      rsi14,
      kdj: { k: kdjRes.k[last], d: kdjRes.d[last], j: kdjRes.j[last] },
      volRatio: vr,
      atrPct: atr14 != null && closes[last] > 0 ? atr14 / closes[last] : null,
    },
  };
}

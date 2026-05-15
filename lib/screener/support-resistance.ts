/**
 * 关键价位（支撑 / 压力）计算
 *
 * 设计要点：
 *   - 候选价位由 5 类技术依据合成：
 *       1) 中长期均线 MA20 / MA60 / MA120
 *       2) 近期高低点 N 日内 (N=20/60/120)
 *       3) BOLL 上下轨（20,2）
 *       4) 斐波那契回撤（基于 60 日高低点）
 *       5) 整数关口（50 / 100 / 200 等）
 *   - 多重重合自动合并：相邻 0.5% 内的两个候选合并 label，强度升一档
 *   - 按距离当前价排序：压力位升序、支撑位降序
 *   - 每类带 strength（weak / medium / strong），UI 用颜色和粗细区分
 */
import type { KLine } from "@/lib/data/kline-cache";
import { boll } from "@/lib/indicators/boll";

export type LevelStrength = "weak" | "medium" | "strong";
export type LevelType =
  | "ma"
  | "recent_high"
  | "recent_low"
  | "boll_upper"
  | "boll_lower"
  | "fib"
  | "round";

export interface PriceLevel {
  type: LevelType;
  label: string;
  price: number;
  /** (price - current) / current，正数为压力，负数为支撑 */
  distance: number;
  strength: LevelStrength;
  note?: string;
}

export interface SupportResistance {
  current: number;
  /** 当前价之上的关键价位，价格升序（从近到远） */
  resistances: PriceLevel[];
  /** 当前价之下的关键价位，价格降序（从近到远） */
  supports: PriceLevel[];
  /** 一句话提示（贴近某关键位时给出） */
  hint?: string;
}

interface Candidate {
  type: LevelType;
  label: string;
  price: number;
  strength: LevelStrength;
  note?: string;
}

const STRENGTH_RANK: Record<LevelStrength, number> = {
  weak: 1,
  medium: 2,
  strong: 3,
};

export function computeSupportResistance(kline: KLine[]): SupportResistance {
  if (kline.length < 20) {
    const current = kline.length ? kline[kline.length - 1].close : 0;
    return { current, resistances: [], supports: [] };
  }

  const closes = kline.map((k) => k.close);
  const current = closes[closes.length - 1];
  const candidates: Candidate[] = [];

  // 1) 均线
  const ma20 = avg(closes.slice(-20));
  candidates.push({
    type: "ma",
    label: "MA20",
    price: ma20,
    strength: "medium",
  });
  if (closes.length >= 60) {
    const ma60 = avg(closes.slice(-60));
    candidates.push({
      type: "ma",
      label: "MA60",
      price: ma60,
      strength: "strong",
      note: "中线趋势",
    });
  }
  if (closes.length >= 120) {
    const ma120 = avg(closes.slice(-120));
    candidates.push({
      type: "ma",
      label: "MA120",
      price: ma120,
      strength: "strong",
      note: "中长期生命线",
    });
  }
  if (closes.length >= 250) {
    const ma250 = avg(closes.slice(-250));
    candidates.push({
      type: "ma",
      label: "MA250",
      price: ma250,
      strength: "strong",
      note: "年线",
    });
  }

  // 2) 近期高低点（剔除当日）
  const recentBars = kline.slice(0, -1); // 排除当日防止当日影响判断
  const win20 = recentBars.slice(-20);
  const win60 = recentBars.slice(-60);
  const win120 = recentBars.slice(-120);

  if (win20.length >= 20) {
    candidates.push({
      type: "recent_high",
      label: "20 日高",
      price: Math.max(...win20.map((k) => k.high)),
      strength: "medium",
    });
    candidates.push({
      type: "recent_low",
      label: "20 日低",
      price: Math.min(...win20.map((k) => k.low)),
      strength: "medium",
    });
  }
  if (win60.length >= 60) {
    candidates.push({
      type: "recent_high",
      label: "60 日高",
      price: Math.max(...win60.map((k) => k.high)),
      strength: "strong",
    });
    candidates.push({
      type: "recent_low",
      label: "60 日低",
      price: Math.min(...win60.map((k) => k.low)),
      strength: "strong",
    });
  }
  if (win120.length >= 120) {
    candidates.push({
      type: "recent_high",
      label: "120 日高",
      price: Math.max(...win120.map((k) => k.high)),
      strength: "strong",
      note: "中长期阻力",
    });
    candidates.push({
      type: "recent_low",
      label: "120 日低",
      price: Math.min(...win120.map((k) => k.low)),
      strength: "strong",
      note: "中长期支撑",
    });
  }

  // 3) BOLL 上下轨
  const b = boll(closes, 20, 2);
  const upper = b.upper[b.upper.length - 1];
  const lower = b.lower[b.lower.length - 1];
  if (upper != null) {
    candidates.push({
      type: "boll_upper",
      label: "BOLL 上轨",
      price: upper,
      strength: "weak",
    });
  }
  if (lower != null) {
    candidates.push({
      type: "boll_lower",
      label: "BOLL 下轨",
      price: lower,
      strength: "weak",
    });
  }

  // 4) 斐波那契回撤（基于 60 日高低）
  if (win60.length >= 60) {
    const high60 = Math.max(...win60.map((k) => k.high));
    const low60 = Math.min(...win60.map((k) => k.low));
    const range = high60 - low60;
    if (range > 0) {
      const fibs: Array<{ r: number; s: LevelStrength }> = [
        { r: 0.236, s: "weak" },
        { r: 0.382, s: "medium" },
        { r: 0.5, s: "medium" },
        { r: 0.618, s: "medium" },
        { r: 0.786, s: "weak" },
      ];
      for (const f of fibs) {
        candidates.push({
          type: "fib",
          label: `斐波 ${(f.r * 100).toFixed(1)}%`,
          price: low60 + f.r * range,
          strength: f.s,
        });
      }
    }
  }

  // 5) 整数关口（仅取最近的两档：上方/下方各一档）
  for (const p of nearestRoundLevels(current)) {
    candidates.push({
      type: "round",
      label: `整数关 ${formatRound(p)}`,
      price: p,
      strength: "weak",
    });
  }

  // 合并相邻 0.5% 内的候选
  candidates.sort((a, b) => a.price - b.price);
  const merged: Candidate[] = [];
  for (const c of candidates) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(c.price - last.price) / current < 0.005) {
      last.label = `${last.label} + ${c.label}`;
      // 多重重合 → 强度升一档（最高 strong）
      if (
        STRENGTH_RANK[c.strength] >= STRENGTH_RANK[last.strength] &&
        last.strength !== "strong"
      ) {
        last.strength =
          last.strength === "weak"
            ? "medium"
            : "strong";
      } else if (last.strength !== "strong") {
        last.strength = "strong"; // 任意两档重合都升级
      }
      // 备注合并
      if (c.note && !last.note) last.note = c.note;
      else if (c.note && last.note && !last.note.includes(c.note))
        last.note = `${last.note} · ${c.note}`;
    } else {
      merged.push({ ...c });
    }
  }

  const resistances = merged
    .filter((l) => l.price > current)
    .map((l) => ({ ...l, distance: (l.price - current) / current }))
    .sort((a, b) => a.price - b.price)
    .slice(0, 5);

  const supports = merged
    .filter((l) => l.price < current)
    .map((l) => ({ ...l, distance: (l.price - current) / current }))
    .sort((a, b) => b.price - a.price)
    .slice(0, 5);

  const hint = buildHint(supports, resistances);
  return { current, resistances, supports, hint };
}

function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** 当前价附近的整数关口（A 股 1 元 / 5 元 / 10 元 / 50 元 步长，因价位区间动态选） */
function nearestRoundLevels(current: number): number[] {
  let step = 1;
  if (current >= 200) step = 10;
  else if (current >= 100) step = 5;
  else if (current >= 50) step = 1;
  else if (current >= 20) step = 1;
  else if (current >= 10) step = 0.5;
  else step = 0.5;

  const up = Math.ceil(current / step) * step;
  const down = Math.floor(current / step) * step;
  // 上下各取一档，避免靠太近重复
  const set = new Set<number>();
  if (Math.abs(up - current) / current > 0.001) set.add(up);
  if (Math.abs(down - current) / current > 0.001) set.add(down);
  return Array.from(set);
}

function formatRound(p: number): string {
  if (p >= 100) return p.toFixed(0);
  if (p >= 10) return p.toFixed(1);
  return p.toFixed(2);
}

function buildHint(
  supports: PriceLevel[],
  resistances: PriceLevel[]
): string | undefined {
  const nearestSup = supports[0];
  const nearestRes = resistances[0];
  // 贴近 1% 以内
  if (nearestRes && nearestRes.distance < 0.01) {
    return `📌 已贴近${strengthLabel(nearestRes.strength)}压力 ${nearestRes.label}（仅 ${
      (nearestRes.distance * 100).toFixed(2)
    }%），警惕回踩`;
  }
  if (nearestSup && Math.abs(nearestSup.distance) < 0.01) {
    return `📌 已贴近${strengthLabel(nearestSup.strength)}支撑 ${nearestSup.label}（仅 ${
      (Math.abs(nearestSup.distance) * 100).toFixed(2)
    }%），关注是否止跌`;
  }
  // 距压力较远 + 距支撑也较远 → 中性
  if (nearestRes && nearestSup) {
    const upRoom = nearestRes.distance;
    const downRoom = Math.abs(nearestSup.distance);
    if (upRoom > 2 * downRoom) {
      return `↗ 距上方压力 ${(upRoom * 100).toFixed(1)}% > 距下方支撑 ${(downRoom * 100).toFixed(1)}%，上行空间相对更大`;
    }
    if (downRoom > 2 * upRoom) {
      return `↘ 距下方支撑 ${(downRoom * 100).toFixed(1)}% > 距上方压力 ${(upRoom * 100).toFixed(1)}%，警惕回调`;
    }
  }
  return undefined;
}

export function strengthLabel(s: LevelStrength): string {
  return s === "strong" ? "强" : s === "medium" ? "中" : "弱";
}

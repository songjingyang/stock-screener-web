/**
 * 命中股票的「值得买入」综合置信度评分
 *
 * 设计原则（KISS / YAGNI）：
 *   - 只用已经传到前端的数据（评分、量比、30 日收盘），不引入新的远端接口
 *   - 纯函数，可在客户端 useMemo 里直接调用
 *   - 多分量加权 + 显式权重，方便用户日后微调
 *
 * 五个维度（每个分量 ∈ [0, 1]）：
 *   T  技术评分占比     0.40   weight 越大、信号越多越好
 *   V  量比合理性       0.20   理想 1.5–3.0；过低无量、过高异动追高
 *   G  30 日涨幅        0.15   理想 5–15%；负或巨涨都减分
 *   S  价格波动稳定性   0.10   30 日变异系数越低越稳健
 *   P  当前位 vs 均线   0.15   理想现价高于 30 日均价 3–8%
 *
 *   置信度 = 100 * Σ(wᵢ * sᵢ) ，落入 [0, 100]
 */

export interface RecommendInput {
  pass: boolean;
  score: number;
  maxScore: number;
  volRatio: number | null;
  recentCloses?: number[];
}

export interface RecommendBreakdown {
  /** 技术评分（满分占比） */
  technical: number;
  /** 量比合理性 */
  volume: number;
  /** 30 日涨幅 */
  gain30d: number;
  /** 30 日波动稳定性 */
  stability: number;
  /** 当前价相对 30 日均价位置 */
  position: number;
}

export interface Recommendation {
  /** 综合置信度，0~100 */
  confidence: number;
  /** 各分量明细（便于理由生成与调试） */
  breakdown: RecommendBreakdown;
  /** 用户可读的中文理由（按重要性排序，最多 4 条） */
  reasons: string[];
  /** 提示风险点（不影响打分，只在 UI 里以小字提示） */
  risks: string[];
}

const W = {
  technical: 0.4,
  volume: 0.2,
  gain30d: 0.15,
  stability: 0.1,
  position: 0.15,
};

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * 钟形偏好函数：以 ideal 为峰、sigma 控宽，落点越接近 ideal 得分越接近 1
 */
function bell(value: number, ideal: number, sigma: number): number {
  const d = (value - ideal) / sigma;
  return Math.exp(-0.5 * d * d);
}

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function stdev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let acc = 0;
  for (const v of arr) acc += (v - m) * (v - m);
  return Math.sqrt(acc / (arr.length - 1));
}

export function evaluateRecommendation(item: RecommendInput): Recommendation {
  const reasons: string[] = [];
  const risks: string[] = [];

  // ---- T 技术评分 ----
  const technical = item.maxScore > 0 ? item.score / item.maxScore : 0;
  if (technical >= 0.99) reasons.push(`满分共振 ${item.score}/${item.maxScore}，多指标同向`);
  else if (technical >= 0.85) reasons.push(`技术评分 ${item.score}/${item.maxScore}，信号偏强`);
  else if (technical < 0.7 && item.pass) risks.push("条件命中但评分中等，注意确认");

  // ---- V 量比 ----
  let volume = 0.5;
  if (item.volRatio != null && Number.isFinite(item.volRatio)) {
    const v = item.volRatio;
    volume = bell(v, 2.0, 1.0);
    if (v >= 1.5 && v <= 3.0) reasons.push(`量比 ${v.toFixed(2)}，温和放量右侧确认`);
    else if (v > 5) risks.push(`量比 ${v.toFixed(2)} 偏高，警惕短线追高`);
    else if (v < 1.0) risks.push(`量比 ${v.toFixed(2)} 偏低，资金参与不足`);
  }

  // ---- G 30 日涨幅 ----
  let gain30d = 0.5;
  let chgPct: number | null = null;
  if (item.recentCloses && item.recentCloses.length >= 5) {
    const c = item.recentCloses;
    chgPct = ((c[c.length - 1] - c[0]) / c[0]) * 100;
    gain30d = bell(chgPct, 8, 10);
    if (chgPct >= 3 && chgPct <= 18) reasons.push(`近 30 日 +${chgPct.toFixed(1)}%，温和上行未追高`);
    else if (chgPct > 30) risks.push(`30 日 +${chgPct.toFixed(1)}%，涨幅过大需谨慎`);
    else if (chgPct < -5) risks.push(`30 日 ${chgPct.toFixed(1)}%，仍处下跌通道`);
  }

  // ---- S 波动稳定性 ----
  let stability = 0.5;
  if (item.recentCloses && item.recentCloses.length >= 5) {
    const c = item.recentCloses;
    const m = mean(c);
    const sd = stdev(c);
    const cv = m > 0 ? sd / m : 0; // 变异系数
    // cv 0 => 1 分；cv 0.15 => 0 分
    stability = clamp(1 - cv / 0.15, 0, 1);
    if (cv < 0.04) reasons.push("近 30 日波动收敛，走势稳健");
    else if (cv > 0.1) risks.push("近 30 日波动偏大");
  }

  // ---- P 现价 vs 30 日均价 ----
  let position = 0.5;
  if (item.recentCloses && item.recentCloses.length >= 5) {
    const c = item.recentCloses;
    const m = mean(c);
    if (m > 0) {
      const ratio = c[c.length - 1] / m; // 1.05 表示现价高于均线 5%
      position = bell(ratio, 1.05, 0.05);
      const pct = (ratio - 1) * 100;
      if (pct >= 2 && pct <= 8) reasons.push(`现价高于 30 日均价 ${pct.toFixed(1)}%，处于良性右侧`);
      else if (pct < -3) risks.push(`现价低于 30 日均价 ${(-pct).toFixed(1)}%，仍待企稳`);
      else if (pct > 15) risks.push(`现价高于 30 日均价 ${pct.toFixed(1)}%，乖离偏大`);
    }
  }

  const breakdown: RecommendBreakdown = {
    technical,
    volume,
    gain30d,
    stability,
    position,
  };

  const confidence =
    100 *
    (W.technical * technical +
      W.volume * volume +
      W.gain30d * gain30d +
      W.stability * stability +
      W.position * position);

  // 取前 4 条最有用的理由（reasons 已经按维度顺序大致从权重高到低）
  return {
    confidence: Math.round(confidence),
    breakdown,
    reasons: reasons.slice(0, 4),
    risks: risks.slice(0, 3),
  };
}

/**
 * 在一组候选中挑出 top N（要求 pass=true）
 */
export function pickTopRecommendations<
  T extends RecommendInput & { tsCode: string },
>(items: T[], n: number = 2): Array<T & { rec: Recommendation }> {
  return items
    .filter((it) => it.pass)
    .map((it) => ({ ...it, rec: evaluateRecommendation(it) }))
    .sort((a, b) => b.rec.confidence - a.rec.confidence)
    .slice(0, n);
}

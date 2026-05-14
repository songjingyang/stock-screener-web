/**
 * 内置策略预设：右侧交易高胜率指标体系
 *
 * 1) 三指标共振（迁移自 stock-screener-ext/src/screener.js 的默认规则）
 * 2) 强势缩量回踩（趋势中健康洗盘）
 * 3) 平台突破（窄幅整理后放量突破）
 * 4) 全指标共振（在 1 的基础上叠加 RSI/KDJ/ATR 风控）
 */
import type { RuleConfig } from "./rule-engine";

/**
 * 操盘手册：每个策略对应的买卖纪律
 * 设计取舍：所有数值字符串化，UI 直接展示；不内置自动下单逻辑。
 */
export interface StrategyPlaybook {
  /** 标签：右侧买点 / 加仓位 / 趋势启动 / 高胜率 等 */
  tag: string;
  /** 适合的市场环境 / 资金特点（一句话） */
  suitFor: string;
  /** 不适用的情形（避免误用） */
  avoid: string;
  /** 何时买入：触发条件 + 操作时机 */
  entry: string;
  /** 何时止损：硬性纪律 */
  stopLoss: string;
  /** 何时卖出：分批止盈 / 趋势破坏信号 */
  exit: string;
  /** 典型持有时间 */
  holdPeriod: string;
  /** 仓位建议（轻仓 / 标准 / 重仓） */
  position: string;
}

export interface BuiltinStrategy {
  name: string;
  description: string;
  ruleConfig: RuleConfig;
  playbook: StrategyPlaybook;
}

export const BUILTIN_STRATEGIES: BuiltinStrategy[] = [
  {
    name: "三指标共振",
    description: "均线多头排列 + MACD 0 轴上金叉 + 放量突破前高，最经典的右侧买点。",
    ruleConfig: {
      name: "三指标共振",
      logic: "AND",
      conditions: [
        { type: "ma_bull", periods: [5, 10, 20, 60] },
        { type: "ma_slope_up", period: 20, lookback: 3 },
        { type: "macd_above_zero" },
        { type: "macd_golden", window: 3 },
        { type: "vol_ratio_gte", ratio: 1.5, base: 5 },
        { type: "break_n_high", period: 20 },
      ],
    },
    playbook: {
      tag: "经典右侧买点",
      suitFor: "中波段趋势加速段；个股突破前期平台、量能温和放大。",
      avoid: "大盘指数下行、个股已加速末段（连续 3 日 +5% 以上）、量比 > 3 的爆量。",
      entry:
        "扫描命中当日尾盘 14:50 后或次日开盘 1% 以内介入；若高开 2% 以上，等首次回踩 5 日均线再上车。",
      stopLoss: "买入价 -7%，或收盘跌破 MA20，二者先到先止损（不抗跌、不补仓）。",
      exit:
        "分批止盈：+8% 减 1/3 仓；+15% 再减 1/3 仓；剩余仓位用 MA10 跟踪——收盘跌破 MA10 全清。",
      holdPeriod: "3–15 个交易日（中波段）",
      position: "标准仓（单只 10–20%）",
    },
  },
  {
    name: "强势缩量回踩",
    description: "趋势完好时缩量回踩 MA20 不破，是低风险加仓位置。",
    ruleConfig: {
      name: "强势缩量回踩",
      logic: "AND",
      conditions: [
        { type: "ma_bull", periods: [5, 10, 20, 60] },
        { type: "ma_slope_up", period: 20, lookback: 5 },
        { type: "vol_shrink_pullback", base: 5, ratioLt: 0.8, maPeriod: 20 },
        { type: "rsi_in", period: 14, min: 45, max: 70 },
      ],
    },
    playbook: {
      tag: "趋势中加仓位",
      suitFor: "已有底仓的强势股回踩补仓；适合在已盈利的标的上加码。",
      avoid: "MA60 已转下行；回踩日 RSI < 45（强势已破）；近 5 日有跳空缺口未回补。",
      entry: "缩量回踩当日收盘前确认收在 MA20 之上 → 收盘前买入；或次日回踩不破 MA20 时介入。",
      stopLoss: "MA20 下方 3% 处放止损；若放量跌破 MA20 立即清仓不犹豫。",
      exit:
        "放量重新站上前期高点时减半；若再次出现量比 > 1.5 的滞涨阴线 → 全清。趋势未破可一直持有。",
      holdPeriod: "5–10 个交易日",
      position: "可重仓加码（在原有底仓上 +30–50%）",
    },
  },
  {
    name: "平台突破",
    description: "前 20 日窄幅整理（收盘振幅 < 8%）后放量突破，趋势启动信号。",
    ruleConfig: {
      name: "平台突破",
      logic: "AND",
      conditions: [
        { type: "platform_breakout", lookback: 20, band: 0.08 },
        { type: "vol_ratio_gte", ratio: 1.8, base: 5 },
        { type: "ma_not_down", period: 60, lookback: 5 },
      ],
    },
    playbook: {
      tag: "趋势启动",
      suitFor: "横盘整理充分（≥ 20 日）、量能干涸后首次放量突破；中长线建仓最佳时点。",
      avoid:
        "突破当日单日涨幅 > 7%（追高风险）；量比 < 1.5（假突破）；MA60 仍向下（底部反弹而非新趋势）。",
      entry:
        "突破当日 1% 内追入 1/2 仓位；次日回踩平台上沿不破 → 加满。若直接低开跌回平台内 → 视为假突破撤退。",
      stopLoss: "平台中位数下方 5%（即跌回横盘区中部）即认错出局。",
      exit:
        "突破后第 1–2 个上涨阶段（通常 +15–30%）出现 单日量比 > 3 + 长上影 → 减半止盈；趋势线（连接突破日低点 + MA20）破位 → 清仓。",
      holdPeriod: "5–30 个交易日（突破空间通常较大）",
      position: "标准仓首买 1/2，确认有效后加至 1.5 倍标准仓",
    },
  },
  {
    name: "全指标共振（高胜率）",
    description: "在三共振基础上叠加 RSI 强势、KDJ 金叉、ATR 风控，过滤妖股/僵尸股。",
    ruleConfig: {
      name: "全指标共振（高胜率）",
      logic: "AND",
      conditions: [
        { type: "ma_bull", periods: [5, 10, 20, 60] },
        { type: "ma_slope_up", period: 20, lookback: 3 },
        { type: "macd_above_zero" },
        { type: "macd_golden", window: 3 },
        { type: "rsi_in", period: 14, min: 50, max: 80 },
        { type: "kdj_golden", window: 3 },
        { type: "vol_ratio_gte", ratio: 1.5, base: 5 },
        { type: "break_n_high", period: 20 },
        { type: "atr_pct_in", period: 14, min: 0.01, max: 0.06 },
      ],
    },
    playbook: {
      tag: "高胜率（资金量大首选）",
      suitFor: "胜率优先 / 不想试错 / 单笔金额大；条件最严格、命中数量最少但确定性高。",
      avoid: "RSI > 80（已超买）；ATR% > 6%（妖股）；连续 3 日缩量横盘（动能衰竭）。",
      entry: "扫描命中当日尾盘 14:50 后或次日开盘介入；不追高，高开 > 2% 等回踩。",
      stopLoss: "买入价 -5% 或收盘跌破 MA20，二者先到（高胜率策略对应更紧的止损）。",
      exit:
        "分批止盈：+10% 减 1/3；+20% 再减 1/3；MACD 死叉 或 KDJ 在高位死叉 → 全清。",
      holdPeriod: "5–20 个交易日",
      position: "可重仓（单只 20–30%）",
    },
  },
];

export function getBuiltinByName(name: string): BuiltinStrategy | undefined {
  return BUILTIN_STRATEGIES.find((s) => s.name === name);
}

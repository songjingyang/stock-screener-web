/**
 * 内置策略预设：右侧交易高胜率指标体系
 *
 * 1) 三指标共振（迁移自 stock-screener-ext/src/screener.js 的默认规则）
 * 2) 强势缩量回踩（趋势中健康洗盘）
 * 3) 平台突破（窄幅整理后放量突破）
 * 4) 全指标共振（在 1 的基础上叠加 RSI/KDJ/ATR 风控）
 */
import type { RuleConfig } from "./rule-engine";

export interface BuiltinStrategy {
  name: string;
  description: string;
  ruleConfig: RuleConfig;
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
  },
];

export function getBuiltinByName(name: string): BuiltinStrategy | undefined {
  return BUILTIN_STRATEGIES.find((s) => s.name === name);
}

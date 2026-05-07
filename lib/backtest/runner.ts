/**
 * 简化回测器：对每只股票逐日扫描，命中则模拟"次日开盘买入 + 持有 N 日后卖出"。
 *
 * 假设（KISS）：
 *   - 不考虑滑点、手续费
 *   - 同一只股票同时只持一笔仓位（命中后等卖出再买入）
 *   - 卖出价 = 买入后第 N 个交易日的收盘价
 */
import { evaluate, type RuleConfig } from "@/lib/screener/rule-engine";
import type { KLine } from "@/lib/data/kline-cache";

export interface BacktestParams {
  startDate: string; // YYYYMMDD
  endDate: string;
  holdDays: number; // 持有交易日数
}

export interface Trade {
  tsCode: string;
  signalDate: string;
  buyDate: string;
  sellDate: string;
  buyPrice: number;
  sellPrice: number;
  ret: number; // (sell - buy) / buy
}

export interface BacktestStockResult {
  tsCode: string;
  trades: Trade[];
}

export interface BacktestSummary {
  totalTrades: number;
  winCount: number;
  winRate: number;
  avgReturn: number;
  bestReturn: number;
  worstReturn: number;
  maxDrawdown: number;
  cumulativeCurve: Array<{ date: string; cum: number }>;
  trades: Trade[];
}

export function backtestSingle(
  tsCode: string,
  kline: KLine[],
  rule: RuleConfig,
  params: BacktestParams
): BacktestStockResult {
  const trades: Trade[] = [];
  if (kline.length < 70) return { tsCode, trades };

  let cooldownUntil = -1; // 下次允许买入的最小索引（持仓互不重叠）

  // 至少需要 60 根做指标，从 60 开始向后逐日评估
  for (let i = 60; i < kline.length - 1; i++) {
    const bar = kline[i];
    if (bar.date < params.startDate || bar.date > params.endDate) continue;
    if (i < cooldownUntil) continue;

    // 用 [0..i] 这段 K 线模拟 “截至该日”
    const slice = kline.slice(0, i + 1);
    const result = evaluate(slice, rule);
    if (!result || !result.pass) continue;

    // 次日按开盘买入；持有 holdDays 个交易日后按收盘卖出
    const buyIdx = i + 1;
    const sellIdx = Math.min(buyIdx + params.holdDays, kline.length - 1);
    if (buyIdx >= kline.length) continue;
    const buyBar = kline[buyIdx];
    const sellBar = kline[sellIdx];
    if (!buyBar || !sellBar) continue;

    const buyPrice = buyBar.open;
    const sellPrice = sellBar.close;
    if (buyPrice <= 0) continue;
    const ret = (sellPrice - buyPrice) / buyPrice;

    trades.push({
      tsCode,
      signalDate: bar.date,
      buyDate: buyBar.date,
      sellDate: sellBar.date,
      buyPrice,
      sellPrice,
      ret,
    });

    cooldownUntil = sellIdx + 1;
  }
  return { tsCode, trades };
}

/**
 * 汇总多只股票的回测
 */
export function summarize(stockResults: BacktestStockResult[]): BacktestSummary {
  const trades: Trade[] = [];
  for (const s of stockResults) trades.push(...s.trades);

  // 按卖出日期排序累加收益曲线（粗略：每笔等权重）
  trades.sort((a, b) => a.sellDate.localeCompare(b.sellDate));

  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  const curve: Array<{ date: string; cum: number }> = [];
  for (const t of trades) {
    cum += t.ret;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
    curve.push({ date: t.sellDate, cum });
  }

  const total = trades.length;
  const wins = trades.filter((t) => t.ret > 0).length;
  const sum = trades.reduce((s, t) => s + t.ret, 0);
  const avg = total ? sum / total : 0;
  const best = trades.reduce((m, t) => Math.max(m, t.ret), 0);
  const worst = trades.reduce((m, t) => Math.min(m, t.ret), 0);

  return {
    totalTrades: total,
    winCount: wins,
    winRate: total ? wins / total : 0,
    avgReturn: avg,
    bestReturn: best,
    worstReturn: worst,
    maxDrawdown: maxDD,
    cumulativeCurve: curve,
    trades,
  };
}

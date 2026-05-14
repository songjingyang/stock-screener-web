/**
 * 板块轮动聚合
 *
 * 设计要点：
 *   1) 数据完全自给：用本地 KlineDaily 缓存 + Stock.industry（申万一级）聚合，
 *      不依赖任何外部聚合接口
 *   2) 一次性 SQL：拉取最近 N 个交易日（N=22）的 close/vol，按 tsCode 内存分组
 *   3) 轮动判定：基于「短期动量 + 趋势宽度 + 加速度」组合，KISS 不引入 ML
 *
 * 指标释义：
 *   - return1d / return5d / return20d：板块内成分股等权平均涨跌幅
 *   - breadth：当前价 > MA20 的成分股占比（趋势宽度）
 *   - volRatio：今日成交量 / 5 日均量 的等权平均
 *   - acceleration：5 日均涨幅 - 20 日均涨幅，> 0 表示动能在加速
 *
 * 轮动状态（state）：
 *   leading      主升：r1>0 & r5>2% & r20>3% & breadth>0.6
 *   rotating-in  轮入：r1>1.5% & breadth>0.4 & acceleration>0 & r20<2%（前期不强）
 *   rotating-out 轮出：r1<-1% & r5>0 & breadth<0.5（前期强势但今天回吐）
 *   lagging      弱势：r1<0 & r5<0 & r20<0
 *   neutral      中性：其余
 */
import { prisma } from "@/lib/db/prisma";
import { fetchTencentQuoteBatch } from "@/lib/data/tencent";
import { isMarketOpen, toCalDate } from "@/lib/data/kline-cache";

export type RotationState =
  | "leading"
  | "rotating-in"
  | "rotating-out"
  | "lagging"
  | "neutral";

export interface IndustryMetric {
  industry: string;
  count: number;
  return1d: number;
  return5d: number;
  return20d: number;
  /** 当前价 > MA20 的成分股占比（0-1） */
  breadth: number;
  /** 板块平均量比（今日量 / 5 日均量） */
  volRatio: number;
  /** 5 日均涨幅 − 20 日均涨幅（衡量动能加速度） */
  acceleration: number;
  state: RotationState;
  /** Top 5 涨幅成分股（用于卡片预览） */
  topMovers: Array<{
    tsCode: string;
    name: string;
    return1d: number;
    close: number;
  }>;
}

export interface RotationSnapshot {
  /** 用于显示的"最新交易日" YYYYMMDD */
  asOf: string;
  /** 是否盘中实时合并（true 时 return1d 已含分时） */
  realtime: boolean;
  /** 板块指标，已按 return1d 降序 */
  industries: IndustryMetric[];
  /** 数据未覆盖的股票数（无 industry 或无 K 线） */
  uncovered: number;
}

interface ClosesEntry {
  /** 时间升序的最近 N 个交易日收盘价 */
  closes: number[];
  /** 时间升序的最近 N 个交易日成交量（手） */
  vols: number[];
  /** 末根日期 YYYYMMDD（用于判断是否覆盖到 today） */
  lastDate: string;
}

/**
 * 主入口：构建板块轮动快照
 *
 * @param days 拉取的近 N 个交易日 K 线条数（默认 22，足够算 20 日涨幅 + MA20）
 */
export async function buildRotationSnapshot(
  days = 22
): Promise<RotationSnapshot> {
  // 1) 一次性拉取最近 N 个交易日的 K 线
  //    用 cutoff = today - days*1.6（保留节假日 buffer）粗筛，内存里再按 tsCode 取最近 N 条
  const today = toCalDate();
  const cutoff = shiftDays(today, -Math.ceil(days * 1.6));
  const rows = await prisma.klineDaily.findMany({
    where: { tradeDate: { gte: cutoff, lte: today } },
    orderBy: [{ tsCode: "asc" }, { tradeDate: "asc" }],
    select: { tsCode: true, tradeDate: true, close: true, vol: true },
  });

  // 2) 按 tsCode 分组，仅保留每只股票最近 days 条
  const byCode = new Map<string, ClosesEntry>();
  for (const r of rows) {
    const e = byCode.get(r.tsCode);
    if (!e) {
      byCode.set(r.tsCode, {
        closes: [r.close],
        vols: [r.vol],
        lastDate: r.tradeDate,
      });
    } else {
      e.closes.push(r.close);
      e.vols.push(r.vol);
      e.lastDate = r.tradeDate;
    }
  }
  for (const e of byCode.values()) {
    if (e.closes.length > days) {
      e.closes = e.closes.slice(-days);
      e.vols = e.vols.slice(-days);
    }
  }

  // 3) 交易时段：批量拉实时报价覆盖 last close（并把今日合成一根虚拟 K 线）
  const realtime = isMarketOpen();
  if (realtime && byCode.size > 0) {
    const tsCodes = Array.from(byCode.keys());
    const quotes = await fetchTencentQuoteBatch(tsCodes).catch(
      () => new Map()
    );
    for (const code of tsCodes) {
      const q = quotes.get(code);
      const e = byCode.get(code);
      if (!q || !e) continue;
      if (e.lastDate === today) {
        // 末根已经是今日（盘中合成），覆盖 close / vol
        e.closes[e.closes.length - 1] = q.close;
        e.vols[e.vols.length - 1] = q.vol || e.vols[e.vols.length - 1];
      } else {
        // 末根 < today，追加一根今日临时
        e.closes.push(q.close);
        e.vols.push(q.vol || 0);
        if (e.closes.length > days) {
          e.closes.shift();
          e.vols.shift();
        }
        e.lastDate = today;
      }
    }
  }

  // 4) 取所有股票元信息（industry / name）
  const stocks = await prisma.stock.findMany({
    select: { tsCode: true, name: true, industry: true },
  });

  // 5) 按 industry 分组聚合
  const groups = new Map<
    string,
    Array<{
      tsCode: string;
      name: string;
      closes: number[];
      vols: number[];
    }>
  >();
  let uncovered = 0;
  for (const s of stocks) {
    if (!s.industry) {
      uncovered++;
      continue;
    }
    const k = byCode.get(s.tsCode);
    if (!k || k.closes.length < 6) {
      uncovered++;
      continue; // K 线不足以计算 5 日涨幅
    }
    const arr = groups.get(s.industry);
    if (arr)
      arr.push({ tsCode: s.tsCode, name: s.name, closes: k.closes, vols: k.vols });
    else
      groups.set(s.industry, [
        { tsCode: s.tsCode, name: s.name, closes: k.closes, vols: k.vols },
      ]);
  }

  // 6) 算每个板块指标
  const industries: IndustryMetric[] = [];
  for (const [industry, list] of groups.entries()) {
    if (list.length < 3) continue; // 太小的板块不可靠（少于 3 只成分股）

    // 个股各项收益率
    const perStock = list.map((s) => {
      const last = s.closes[s.closes.length - 1];
      const prev1 = s.closes[s.closes.length - 2];
      const prev5 = s.closes[s.closes.length - 6];
      const prev20 = s.closes[Math.max(0, s.closes.length - 21)];
      const r1 = prev1 ? (last - prev1) / prev1 : 0;
      const r5 = prev5 ? (last - prev5) / prev5 : 0;
      const r20 = prev20 ? (last - prev20) / prev20 : 0;
      // MA20：取最后 20 个 close 均值（不足时降级到全部）
      const win = s.closes.slice(-20);
      const ma20 = win.reduce((a, b) => a + b, 0) / win.length;
      const aboveMa20 = last > ma20;
      // 量比：今日量 / 前 5 日均量
      const todayVol = s.vols[s.vols.length - 1] ?? 0;
      const prevVols = s.vols.slice(-6, -1);
      const avgVol5 =
        prevVols.reduce((a, b) => a + b, 0) / (prevVols.length || 1);
      const vr = avgVol5 > 0 ? todayVol / avgVol5 : 0;
      return { ...s, last, r1, r5, r20, aboveMa20, vr };
    });

    const avgR1 = avg(perStock.map((x) => x.r1));
    const avgR5 = avg(perStock.map((x) => x.r5));
    const avgR20 = avg(perStock.map((x) => x.r20));
    const breadth =
      perStock.filter((x) => x.aboveMa20).length / perStock.length;
    const volRatio = avg(perStock.map((x) => x.vr));
    const acceleration = avgR5 / 5 - avgR20 / 20; // 日均涨幅差

    const state = classifyState({
      r1: avgR1,
      r5: avgR5,
      r20: avgR20,
      breadth,
      acceleration,
    });

    const topMovers = perStock
      .slice()
      .sort((a, b) => b.r1 - a.r1)
      .slice(0, 5)
      .map((x) => ({
        tsCode: x.tsCode,
        name: x.name,
        return1d: x.r1,
        close: x.last,
      }));

    industries.push({
      industry,
      count: list.length,
      return1d: avgR1,
      return5d: avgR5,
      return20d: avgR20,
      breadth,
      volRatio,
      acceleration,
      state,
      topMovers,
    });
  }

  industries.sort((a, b) => b.return1d - a.return1d);

  // asOf：用最新一根 K 线的日期作为基准（盘中时为 today）
  const allLastDates = Array.from(byCode.values())
    .map((e) => e.lastDate)
    .sort();
  const asOf = allLastDates.length
    ? allLastDates[allLastDates.length - 1]
    : today;

  return { asOf, realtime, industries, uncovered };
}

function classifyState({
  r1,
  r5,
  r20,
  breadth,
  acceleration,
}: {
  r1: number;
  r5: number;
  r20: number;
  breadth: number;
  acceleration: number;
}): RotationState {
  // 主升：今天涨 + 中短期都强 + 趋势宽度高
  if (r1 > 0 && r5 > 0.02 && r20 > 0.03 && breadth > 0.6) return "leading";
  // 轮入新热点：今日大涨 + 加速度为正 + 趋势宽度过半 + 前期 20 日不强
  if (r1 > 0.015 && acceleration > 0 && breadth > 0.4 && r20 < 0.02)
    return "rotating-in";
  // 轮出：今天回吐 + 前 5 日还在涨 + 趋势宽度下降
  if (r1 < -0.01 && r5 > 0 && breadth < 0.5) return "rotating-out";
  // 弱势：三个时间窗口都跌
  if (r1 < 0 && r5 < 0 && r20 < 0) return "lagging";
  return "neutral";
}

function avg(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function shiftDays(yyyymmdd: string, days: number): string {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6)) - 1;
  const d = Number(yyyymmdd.slice(6, 8));
  const dt = new Date(y, m, d);
  dt.setDate(dt.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`;
}

export function stateLabel(s: RotationState): string {
  switch (s) {
    case "leading":
      return "主升";
    case "rotating-in":
      return "轮入";
    case "rotating-out":
      return "轮出";
    case "lagging":
      return "弱势";
    default:
      return "中性";
  }
}

export function stateColor(s: RotationState): {
  bg: string;
  text: string;
  border: string;
} {
  switch (s) {
    case "leading":
      return {
        bg: "bg-bull/15",
        text: "text-bull",
        border: "border-bull/40",
      };
    case "rotating-in":
      return {
        bg: "bg-amber-500/15",
        text: "text-amber-400",
        border: "border-amber-500/40",
      };
    case "rotating-out":
      return {
        bg: "bg-purple-500/15",
        text: "text-purple-400",
        border: "border-purple-500/40",
      };
    case "lagging":
      return {
        bg: "bg-bear/15",
        text: "text-bear",
        border: "border-bear/40",
      };
    default:
      return {
        bg: "bg-bg-soft",
        text: "text-ink-soft",
        border: "border-line",
      };
  }
}

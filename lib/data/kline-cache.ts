/**
 * K 线缓存层：DB 优先，缺失/过期时回源远端 Provider 并增量入库。
 *
 * Provider 切换策略（KISS）：
 *   - 默认：腾讯财经免费接口（无需 token）
 *   - 配置 `TUSHARE_TOKEN` 后：自动切换到 Tushare Pro（更专业，支持复权口径一致）
 *
 * SOLID：上层 (screener/backtest) 只依赖此处的 KLine 类型，不感知数据源。
 */
import { prisma } from "@/lib/db/prisma";
import { fetchTencentKline, type TencentDailyBar } from "./tencent";
import { fetchKlineQfq, type TushareDaily } from "./tushare";
import { inferBoard } from "./universe";

export interface KLine {
  date: string; // YYYYMMDD
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
  amount: number;
}

export type KlineProvider = "tencent" | "tushare";

/** 当前使用的数据源（仅用于 UI 显示提示） */
export function activeProvider(): KlineProvider {
  return process.env.TUSHARE_TOKEN ? "tushare" : "tencent";
}

/** 把 Date 转成 YYYYMMDD */
export function toCalDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** 把 YYYYMMDD 偏移 N 天 */
function shiftDate(yyyymmdd: string, days: number): string {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6)) - 1;
  const d = Number(yyyymmdd.slice(6, 8));
  const dt = new Date(y, m, d);
  dt.setDate(dt.getDate() + days);
  return toCalDate(dt);
}

/**
 * 拉取远端 K 线（自动按 Provider 选择）
 */
async function fetchRemoteKline(
  tsCode: string,
  fetchStart: string,
  endDate: string
): Promise<KLine[]> {
  if (activeProvider() === "tushare") {
    const rows = await fetchKlineQfq(tsCode, fetchStart, endDate);
    return rows.map(tushareRowToKline);
  }
  // 腾讯接口：按 endDate + count 拉取（足够覆盖 fetchStart 到 endDate）
  const days = Math.max(60, daysBetween(fetchStart, endDate) + 30);
  const rows = await fetchTencentKline(tsCode, days, endDate);
  // 截掉早于 fetchStart 的部分（不影响正确性，节省 DB 写入）
  return rows
    .filter((r) => r.date >= fetchStart && r.date <= endDate)
    .map(tencentRowToKline);
}

function tushareRowToKline(r: TushareDaily): KLine {
  return {
    date: r.trade_date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    vol: r.vol,
    amount: r.amount ?? 0,
  };
}

function tencentRowToKline(r: TencentDailyBar): KLine {
  return {
    date: r.date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    vol: r.vol,
    amount: r.amount,
  };
}

function daysBetween(a: string, b: string): number {
  const ay = Number(a.slice(0, 4));
  const am = Number(a.slice(4, 6)) - 1;
  const ad = Number(a.slice(6, 8));
  const by = Number(b.slice(0, 4));
  const bm = Number(b.slice(4, 6)) - 1;
  const bd = Number(b.slice(6, 8));
  return Math.max(
    0,
    Math.round(
      (new Date(by, bm, bd).getTime() - new Date(ay, am, ad).getTime()) / 86400000
    )
  );
}

/**
 * 获取最近 lookbackDays 个自然日的 K 线（足够覆盖技术指标的最大周期）。
 *
 * @param tsCode 形如 "600519.SH"
 * @param lookbackDays 自然日跨度，默认 400
 */
export async function getKline(
  tsCode: string,
  lookbackDays = 400
): Promise<KLine[]> {
  const today = toCalDate();
  const startDate = shiftDate(today, -lookbackDays);

  // 1) 查询 DB 已缓存的范围
  const cached = await prisma.klineDaily.findMany({
    where: { tsCode, tradeDate: { gte: startDate, lte: today } },
    orderBy: { tradeDate: "asc" },
  });

  const cachedLastDate = cached.length ? cached[cached.length - 1].tradeDate : null;
  const needFetch = shouldFetch(cachedLastDate, today);

  if (needFetch) {
    const fetchStart = cachedLastDate ? shiftDate(cachedLastDate, 1) : startDate;
    const remote = await fetchRemoteKline(tsCode, fetchStart, today).catch((err) => {
      console.warn(`[kline-cache] fetch ${tsCode} failed: ${err.message}`);
      return [] as KLine[];
    });

    if (remote.length) {
      // 自动确保 Stock 行存在（自定义代码 / 非内置池兜底）
      const symbol = tsCode.slice(0, 6);
      await prisma.stock.upsert({
        where: { tsCode },
        update: {},
        create: {
          tsCode,
          symbol,
          name: tsCode,
          market: tsCode.endsWith(".SH")
            ? "SH"
            : tsCode.endsWith(".SZ")
              ? "SZ"
              : "BJ",
          board: inferBoard(symbol),
        },
      });

      await prisma.klineDaily.createMany({
        data: remote.map((r) => ({
          tsCode,
          tradeDate: r.date,
          open: r.open,
          high: r.high,
          low: r.low,
          close: r.close,
          vol: r.vol,
          amount: r.amount,
        })),
      });

      const map = new Map<string, KLine>();
      for (const c of cached) {
        map.set(c.tradeDate, {
          date: c.tradeDate,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          vol: c.vol,
          amount: c.amount,
        });
      }
      for (const r of remote) map.set(r.date, r);
      return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  return cached.map((c) => ({
    date: c.tradeDate,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    vol: c.vol,
    amount: c.amount,
  }));
}

function shouldFetch(cachedLast: string | null, today: string): boolean {
  if (!cachedLast) return true;
  if (cachedLast >= today) return false;
  const hour = new Date().getHours();
  const isAfterClose = hour >= 16; // 北京时间 16:00 后视为今日已收盘
  if (isAfterClose && cachedLast < today) return true;
  return cachedLast < shiftDate(today, -1);
}

/**
 * 批量获取 K 线（用于扫描 / 回测），并发由各 Provider 自身限制。
 */
export async function getKlineBatch(
  tsCodes: string[],
  lookbackDays = 400,
  onProgress?: (done: number, total: number, code: string, ok: boolean) => void
): Promise<Map<string, KLine[]>> {
  const result = new Map<string, KLine[]>();
  let done = 0;
  await Promise.all(
    tsCodes.map(async (code) => {
      try {
        const k = await getKline(code, lookbackDays);
        result.set(code, k);
        onProgress?.(++done, tsCodes.length, code, true);
      } catch (err) {
        console.warn(`[kline-cache] ${code} 失败:`, (err as Error).message);
        result.set(code, []);
        onProgress?.(++done, tsCodes.length, code, false);
      }
    })
  );
  return result;
}

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
import {
  fetchTencentKline,
  fetchTencentQuoteBatch,
  type TencentDailyBar,
} from "./tencent";
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

/** 把 Date 转成 YYYYMMDD（始终按北京时间，避免 Vercel 函数运行在 UTC 引起跨日错位） */
export function toCalDate(d: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d).replace(/-/g, "");
}

/** 当前北京时间小时（0–23） */
function shanghaiHour(): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hour12: false,
  });
  return Number(fmt.format(new Date()).split(":")[0]);
}

/** 北京时间「小时×60 + 分钟」（0–1439），用于精确判断交易时段 */
function shanghaiMinutes(): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.format(new Date()).split(":");
  return Number(parts[0]) * 60 + Number(parts[1]);
}

/** 北京时间当天是否为周末 */
function isShanghaiWeekend(): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
  });
  const wd = fmt.format(new Date());
  return wd === "Sat" || wd === "Sun";
}

/**
 * 是否处于 A 股交易时段
 *   - 9:30–11:30、13:00–15:00 北京时间，工作日
 *   - 注：不识别节假日；节假日内实时报价接口会返回前一交易日数据，
 *     合并到 K 线没有副作用（仅多 1 次网络往返）
 */
export function isMarketOpen(): boolean {
  if (isShanghaiWeekend()) return false;
  const m = shanghaiMinutes();
  const am = m >= 9 * 60 + 30 && m <= 11 * 60 + 30;
  const pm = m >= 13 * 60 && m <= 15 * 60;
  return am || pm;
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

export interface GetKlineOptions {
  /** 自然日跨度，默认 400 */
  lookbackDays?: number;
  /**
   * 强制远端拉取增量。即便缓存判定为"无需更新"也会走腾讯接口补到 today。
   * 用于扫描表单里勾选了"实时拉取最新 K 线"的场景。
   */
  forceRefresh?: boolean;
  /**
   * 交易时段把实时分时价合并到最后一根 K 线。
   *
   * 行为：
   *   - 如果最后一根 K 线日期 = today（腾讯日 K 在盘中会返回当日的实时合成行）：
   *     用实时 close / open / high / low / vol 覆盖，使指标随盘中实时跳动
   *   - 如果最后一根 K 线日期 < today（盘中未返回当日行）：
   *     追加一根"今日临时 K 线"，open=high=low=close=实时价、vol=今日累计量
   *   - 非交易时段（盘后 / 周末）不合并，保持日 K 收盘口径
   */
  mergeRealtime?: boolean;
}

/**
 * 获取最近 lookbackDays 个自然日的 K 线（足够覆盖技术指标的最大周期）。
 *
 * @param tsCode 形如 "600519.SH"
 * @param opts 见 GetKlineOptions（向后兼容：仍接受数字作为 lookbackDays）
 */
export async function getKline(
  tsCode: string,
  opts: GetKlineOptions | number = {}
): Promise<KLine[]> {
  const {
    lookbackDays = 400,
    forceRefresh = false,
    mergeRealtime = false,
  } = typeof opts === "number" ? { lookbackDays: opts } : opts;
  const today = toCalDate();
  const startDate = shiftDate(today, -lookbackDays);

  // 1) 查询 DB 已缓存的范围
  const cached = await prisma.klineDaily.findMany({
    where: { tsCode, tradeDate: { gte: startDate, lte: today } },
    orderBy: { tradeDate: "asc" },
  });

  const cachedLastDate = cached.length ? cached[cached.length - 1].tradeDate : null;
  const needFetch = forceRefresh
    ? cachedLastDate === null || cachedLastDate < today
    : shouldFetch(cachedLastDate, today);

  let bars: KLine[] = cached.map((c) => ({
    date: c.tradeDate,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    vol: c.vol,
    amount: c.amount,
  }));

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
      for (const b of bars) map.set(b.date, b);
      for (const r of remote) map.set(r.date, r);
      bars = Array.from(map.values()).sort((a, b) =>
        a.date.localeCompare(b.date)
      );
    }
  }

  if (mergeRealtime && isMarketOpen() && bars.length > 0) {
    try {
      const quotes = await fetchTencentQuoteBatch([tsCode]);
      const q = quotes.get(tsCode);
      if (q) mergeQuoteIntoKline(bars, q, today);
    } catch {
      /* 实时合并失败不阻塞主流程，沿用日 K close */
    }
  }
  return bars;
}

function shouldFetch(cachedLast: string | null, today: string): boolean {
  if (!cachedLast) return true;
  if (cachedLast >= today) return false;
  const hour = shanghaiHour();
  // 腾讯日 K 一般在 15:00 收盘后即可拉到当日数据，留 30 分钟缓冲
  const isAfterClose = hour >= 15;
  if (isAfterClose && cachedLast < today) return true;
  return cachedLast < shiftDate(today, -1);
}

/**
 * 批量获取 K 线（用于扫描 / 回测），并发由各 Provider 自身限制。
 *
 * 第二个参数向后兼容：可传 number（视为 lookbackDays），也可传 GetKlineOptions。
 *
 * @returns 结果 Map + 错误 Map（key 为 tsCode，value 为错误 message）
 */
export async function getKlineBatch(
  tsCodes: string[],
  opts: GetKlineOptions | number = 400,
  onProgress?: (done: number, total: number, code: string, ok: boolean) => void
): Promise<{ data: Map<string, KLine[]>; errors: Map<string, string> }> {
  const options: GetKlineOptions =
    typeof opts === "number" ? { lookbackDays: opts } : opts;
  const data = new Map<string, KLine[]>();
  const errors = new Map<string, string>();
  let done = 0;
  await Promise.all(
    tsCodes.map(async (code) => {
      try {
        const k = await getKline(code, options);
        data.set(code, k);
        onProgress?.(++done, tsCodes.length, code, true);
      } catch (err) {
        const msg = (err as Error).message;
        console.warn(`[kline-cache] ${code} 失败:`, msg);
        data.set(code, []);
        errors.set(code, msg);
        onProgress?.(++done, tsCodes.length, code, false);
      }
    })
  );

  // 交易时段批量合并实时分时价（仅在 mergeRealtime 显式开启时）
  if (options.mergeRealtime && isMarketOpen()) {
    const okCodes = tsCodes.filter((c) => (data.get(c)?.length ?? 0) > 0);
    if (okCodes.length > 0) {
      const quotes = await fetchTencentQuoteBatch(okCodes).catch(
        () => new Map()
      );
      const today = toCalDate();
      for (const code of okCodes) {
        const q = quotes.get(code);
        if (!q) continue;
        const bars = data.get(code)!;
        mergeQuoteIntoKline(bars, q, today);
      }
    }
  }
  return { data, errors };
}

/**
 * 把实时报价合并到 K 线序列：
 *   - 末根日期 == today：直接覆盖 close / vol 等
 *   - 末根日期 < today：追加一根「今日临时」K 线
 *
 * 注：仅修改内存中的 K 线数组，不写库（盘中实时数据不持久化，
 * 避免污染缓存；下次拉取 cached 后会再次实时合并）
 */
function mergeQuoteIntoKline(
  bars: KLine[],
  q: import("./tencent").RealtimeQuote,
  today: string
): void {
  if (!bars.length) return;
  const last = bars[bars.length - 1];
  if (last.date === today) {
    // 用实时价覆盖盘中合成行
    last.close = q.close;
    last.high = Math.max(last.high, q.high, q.close);
    last.low = Math.min(last.low, q.low, q.close);
    last.open = q.open || last.open;
    last.vol = q.vol || last.vol;
  } else {
    // 追加一根今日临时 K 线
    bars.push({
      date: today,
      open: q.open || q.close,
      high: q.high || q.close,
      low: q.low || q.close,
      close: q.close,
      vol: q.vol,
      amount: 0,
    });
  }
}

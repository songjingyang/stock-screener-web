/**
 * A 股市场期货 / 期权交割日计算（纯本地，无网络）
 *
 * 规则：
 *   - 股指期货 IF / IH / IC / IM：每月第三个周五交割
 *   - 沪深 300、上证 50、中证 1000 股指期权：到期日同步为每月第三个周五
 *   - 国债期货 TS / TF / T / TL：每季末（3/6/9/12 月）的第二个周五交割
 *
 * 三个国债 + 四个股指如果落在节假日会顺延 1 个交易日；
 * 此处不做节假日表（KISS / YAGNI），偏差最多 1-2 天，提醒用途足够。
 */

export type SettlementType = "stock-index" | "treasury";

export interface SettlementEvent {
  /** YYYY-MM-DD */
  date: string;
  type: SettlementType;
  /** 中文展示标签 */
  label: string;
  /** 涉及合约简称数组 */
  contracts: string[];
  /** 距今天数：负数 = 已过；0 = 今日；正数 = 距今 N 天 */
  daysFromToday: number;
}

// ----------------------------------------------------------------------------
// 时区辅助：所有计算锚定上海日历
// ----------------------------------------------------------------------------

/** 返回上海今日的 YYYY-MM-DD（避免 Vercel UTC 容器误差） */
export function todayShanghai(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // en-CA 直接返回 YYYY-MM-DD
}

/** 字符串日期 a - b 的天数差（a, b 都是 YYYY-MM-DD） */
function diffDays(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  const ta = Date.UTC(ya, ma - 1, da);
  const tb = Date.UTC(yb, mb - 1, db);
  return Math.round((ta - tb) / 86400000);
}

// ----------------------------------------------------------------------------
// 核心：本月第 N 个 [星期 X]
// ----------------------------------------------------------------------------

/**
 * 给定月份的第 n 个 weekday 的日期。
 *   weekday: 0=周日, 1=周一, ..., 5=周五, 6=周六
 *   n: 1=第一个, 2=第二个, 3=第三个 ...
 */
function getNthWeekdayOfMonth(
  year: number,
  month: number, // 1-12
  weekday: number,
  n: number
): { y: number; m: number; d: number } {
  // 用 UTC 避免本地时区误差
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (weekday - firstDow + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return { y: year, m: month, d: day };
}

function fmtDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ----------------------------------------------------------------------------
// API
// ----------------------------------------------------------------------------

/**
 * 取未来 N 个月（含本月）的所有交割日，按日期升序。
 * 默认 6 个月。
 */
export function getFuturesSettlementDates(
  monthsAhead: number = 6,
  today: string = todayShanghai()
): SettlementEvent[] {
  const events: SettlementEvent[] = [];
  const [y0, m0] = today.split("-").map(Number);

  for (let i = 0; i < monthsAhead; i++) {
    const total = (m0 - 1) + i;
    const y = y0 + Math.floor(total / 12);
    const m = (total % 12) + 1;

    // 股指期货 / 期权：每月第三个周五
    const stockIdx = getNthWeekdayOfMonth(y, m, 5, 3);
    const stockDate = fmtDate(stockIdx.y, stockIdx.m, stockIdx.d);
    events.push({
      date: stockDate,
      type: "stock-index",
      label: "股指期货 / 期权 月度交割",
      contracts: ["IF", "IH", "IC", "IM"],
      daysFromToday: diffDays(stockDate, today),
    });

    // 国债期货：3/6/9/12 月第二个周五
    if (m === 3 || m === 6 || m === 9 || m === 12) {
      const t = getNthWeekdayOfMonth(y, m, 5, 2);
      const td = fmtDate(t.y, t.m, t.d);
      events.push({
        date: td,
        type: "treasury",
        label: "国债期货 季度交割",
        contracts: ["TS", "TF", "T", "TL"],
        daysFromToday: diffDays(td, today),
      });
    }
  }

  // 过滤掉超过 3 天前的过期事件，保留接下来的
  return events
    .filter((e) => e.daysFromToday >= -1)
    .sort((a, b) => a.date.localeCompare(b.date));
}

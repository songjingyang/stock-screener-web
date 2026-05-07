/**
 * 龙虎榜（游资热榜）数据抓取（东方财富免费 API）
 *
 * 接口（无 token、无登录）：
 *   https://datacenter-web.eastmoney.com/api/data/v1/get
 *     ?reportName=RPT_DAILYBILLBOARD_DETAILSNEW
 *     &columns=ALL
 *     &filter=(TRADE_DATE>='YYYY-MM-DD')(TRADE_DATE<='YYYY-MM-DD')
 *     &sortColumns=BILLBOARD_NET_AMT
 *     &sortTypes=-1
 *
 * 业务口径：
 *   - 这里只关心"游资主导"的上榜个股
 *   - BUY_SEAT_NEW / SELL_SEAT_NEW 是 5 位字符，每位代表一个席位类型：
 *       1 = 普通席位（营业部 / 游资 / 散户）
 *       3 = 机构席位
 *   - 游资主导：买入 5 席位中 "1" 的个数 > "3" 的个数（即 ≥3 个游资）
 *   - 排除可转债 / 基金等非股票（仅保留 SECURITY_TYPE_CODE 058 开头）
 *
 * 失败 / 空数据时返回 null，由 UI 降级处理。
 */

const API_BASE = "https://datacenter-web.eastmoney.com/api/data/v1/get";

export interface LhbHotItem {
  /** YYYY-MM-DD */
  tradeDate: string;
  /** 600519.SH / 000001.SZ */
  tsCode: string;
  name: string;
  /** 涨跌幅 %（正数为涨） */
  changeRate: number;
  closePrice: number;
  /** 龙虎榜买入额（元） */
  buyAmt: number;
  /** 龙虎榜卖出额（元） */
  sellAmt: number;
  /** 龙虎榜净买额（元，正数 = 净买） */
  netAmt: number;
  /** 净买额占当日总成交额比例 %（正负） */
  dealNetRatio: number;
  /** 上榜原因（涨幅偏离 7%、连三日 20% 等） */
  explanation: string;
  /** 东财汇总说明（如 "2家机构买入" / "普通席位买入"） */
  explain: string;
  /** 买入 Top 5 席位中机构数（0~5） */
  buyInstCount: number;
  /** 卖出 Top 5 席位中机构数（0~5） */
  sellInstCount: number;
  /** 游资主导：买入席位中游资数 > 机构数 */
  isYouziLed: boolean;
  /** 纯游资买入：买入 5 席位全是普通席位 */
  isPureYouzi: boolean;
}

export interface LhbHotSnapshot {
  /** 数据所属交易日 YYYYMMDD */
  tradeDate: string;
  /** 全部上榜（已应用 D2 游资主导过滤、已去重），按 netAmt 降序 */
  items: LhbHotItem[];
  /** 当日上榜总数（未过滤前，仅股票），用于 UI 顶部统计 */
  totalListed: number;
}

interface RawRow {
  TRADE_DATE: string;
  SECURITY_CODE: string;
  SECUCODE: string;
  SECURITY_NAME_ABBR: string;
  CLOSE_PRICE: number;
  CHANGE_RATE: number;
  BILLBOARD_BUY_AMT: number;
  BILLBOARD_SELL_AMT: number;
  BILLBOARD_NET_AMT: number;
  DEAL_NET_RATIO: number;
  EXPLANATION: string;
  EXPLAIN: string | null;
  BUY_SEAT_NEW: string | null;
  SELL_SEAT_NEW: string | null;
  MARKET: string;
  SECURITY_TYPE_CODE: string;
}

interface RawResp {
  success?: boolean;
  result?: { data?: RawRow[] } | null;
}

// ----------------------------------------------------------------------------
// 工具：日期处理（沪市时区）
// ----------------------------------------------------------------------------

function shanghaiTodayStr(): string {
  // YYYY-MM-DD（Asia/Shanghai 当前自然日）
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function offsetDate(yyyymmdd: string, offsetDays: number): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + offsetDays * 86400000;
  const dt = new Date(t);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// ----------------------------------------------------------------------------
// 工具：席位字符串解析
// ----------------------------------------------------------------------------

function countDigit(seat: string | null | undefined, digit: "1" | "3"): number {
  if (!seat) return 0;
  let n = 0;
  for (const ch of seat) if (ch === digit) n++;
  return n;
}

// ----------------------------------------------------------------------------
// 单日抓取
// ----------------------------------------------------------------------------

async function fetchOneDay(
  ymd: string,
  pageSize: number,
  timeoutMs: number
): Promise<RawRow[] | null> {
  const params = new URLSearchParams({
    reportName: "RPT_DAILYBILLBOARD_DETAILSNEW",
    columns: "ALL",
    pageNumber: "1",
    pageSize: String(pageSize),
    sortColumns: "BILLBOARD_NET_AMT",
    sortTypes: "-1",
    filter: `(TRADE_DATE>='${ymd}')(TRADE_DATE<='${ymd}')`,
  });
  const url = `${API_BASE}?${params.toString()}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      cache: "no-store",
      signal: ctrl.signal,
      headers: {
        "user-agent": "Mozilla/5.0",
        referer: "https://data.eastmoney.com/",
      },
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as RawResp;
    if (!json.success) return null;
    const rows = json.result?.data ?? [];
    return rows.length ? rows : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ----------------------------------------------------------------------------
// 转换 + 过滤 + 去重
// ----------------------------------------------------------------------------

function toItem(r: RawRow): LhbHotItem {
  const buyInst = countDigit(r.BUY_SEAT_NEW, "3");
  const buyYz = countDigit(r.BUY_SEAT_NEW, "1");
  const sellInst = countDigit(r.SELL_SEAT_NEW, "3");
  const tsCode =
    r.SECUCODE && r.SECUCODE.includes(".")
      ? r.SECUCODE
      : `${r.SECURITY_CODE}.${r.MARKET || "SH"}`;
  return {
    tradeDate: (r.TRADE_DATE || "").slice(0, 10),
    tsCode,
    name: r.SECURITY_NAME_ABBR ?? "",
    changeRate: Number(r.CHANGE_RATE) || 0,
    closePrice: Number(r.CLOSE_PRICE) || 0,
    buyAmt: Number(r.BILLBOARD_BUY_AMT) || 0,
    sellAmt: Number(r.BILLBOARD_SELL_AMT) || 0,
    netAmt: Number(r.BILLBOARD_NET_AMT) || 0,
    dealNetRatio: Number(r.DEAL_NET_RATIO) || 0,
    explanation: r.EXPLANATION ?? "",
    explain: r.EXPLAIN ?? "",
    buyInstCount: buyInst,
    sellInstCount: sellInst,
    isYouziLed: buyYz > buyInst,
    isPureYouzi: buyInst === 0 && buyYz > 0,
  };
}

function isStock(r: RawRow): boolean {
  // 058 开头 = 股票（058001001 主板股票，058001002 创业板股票等）
  return typeof r.SECURITY_TYPE_CODE === "string" && r.SECURITY_TYPE_CODE.startsWith("058");
}

/** 同一只股票多条上榜（不同上榜原因）只保留 netAmt 最大的一条 */
function dedupByCode(items: LhbHotItem[]): LhbHotItem[] {
  const map = new Map<string, LhbHotItem>();
  for (const it of items) {
    const exist = map.get(it.tsCode);
    if (!exist || Math.abs(it.netAmt) > Math.abs(exist.netAmt)) {
      map.set(it.tsCode, it);
    }
  }
  return [...map.values()];
}

// ----------------------------------------------------------------------------
// 对外接口
// ----------------------------------------------------------------------------

export interface FetchLhbHotOptions {
  /** 返回条数，默认 10 */
  limit?: number;
  /** 最多回退天数（盘后未发布 / 节假日），默认 7 */
  maxBackoff?: number;
  /** 单次请求超时，默认 8000 */
  timeoutMs?: number;
  /** 单次拉取的总条数（含非游资），默认 200 */
  pageSize?: number;
}

/**
 * 拉取最近一个交易日的"游资热榜"快照。
 * 只保留游资主导的上榜个股，按净买额降序。
 */
export async function fetchLhbHotList(
  opts: FetchLhbHotOptions = {}
): Promise<LhbHotSnapshot | null> {
  const limit = opts.limit ?? 10;
  const maxBackoff = opts.maxBackoff ?? 7;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const pageSize = opts.pageSize ?? 200;

  const today = shanghaiTodayStr();
  for (let i = 0; i < maxBackoff; i++) {
    const ymd = offsetDate(today, -i);
    const rows = await fetchOneDay(ymd, pageSize, timeoutMs);
    if (!rows) continue;

    const stockRows = rows.filter(isStock);
    if (!stockRows.length) continue;

    const all = stockRows.map(toItem);
    const youzi = all.filter((it) => it.isYouziLed);
    const deduped = dedupByCode(youzi).sort((a, b) => b.netAmt - a.netAmt);
    const items = deduped.slice(0, limit);

    return {
      tradeDate: ymd.replace(/-/g, ""),
      items,
      totalListed: dedupByCode(all).length,
    };
  }
  return null;
}

// ----------------------------------------------------------------------------
// UI 复用工具
// ----------------------------------------------------------------------------

/**
 * 金额格式化：≥1 亿用"亿"；≥1 万用"万"；其余原值。
 * 保留 2 位小数，正数前加 "+"（用于净买额突出方向）。
 */
export function formatMoneyCN(value: number, withSign = false): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  let str: string;
  if (abs >= 1e8) str = `${(value / 1e8).toFixed(2)}亿`;
  else if (abs >= 1e4) str = `${(value / 1e4).toFixed(0)}万`;
  else str = String(Math.round(value));
  if (withSign && value > 0) return `+${str}`;
  return str;
}

/**
 * 从冗长的上榜原因中提取一个简短标签：
 *   "日涨幅偏离值达到7%的前5只证券"      -> "涨7%"
 *   "连续三个交易日内，涨幅偏离值累计达到20%的证券" -> "连3·20%"
 *   "日跌幅偏离值达到7%..."             -> "跌7%"
 *   "换手率达到20%..."                 -> "换20%"
 *   其他                                  -> "异动"
 */
export function shortReason(explanation: string): string {
  const s = explanation || "";
  if (/连续三个交易日内.*涨幅偏离.*20/.test(s)) return "连3·涨20%";
  if (/连续三个交易日内.*跌幅偏离.*20/.test(s)) return "连3·跌20%";
  if (/日涨幅偏离.*7/.test(s)) return "涨7%";
  if (/日跌幅偏离.*7/.test(s)) return "跌7%";
  if (/换手率/.test(s)) return "换手异常";
  if (/振幅/.test(s)) return "振幅异常";
  if (/上市首日/.test(s)) return "上市首日";
  if (/退市/.test(s)) return "退市整理";
  return s.length > 12 ? s.slice(0, 10) + "…" : s || "异动";
}

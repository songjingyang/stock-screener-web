/**
 * Tushare Pro HTTP 客户端
 * 文档：https://tushare.pro/document/2
 *
 * 设计原则：
 *   - KISS：所有接口走同一个 POST /，只有 api_name/params/fields 不同
 *   - 限速：p-limit 控制并发，过频时指数退避
 *   - 容错：积分不足时优雅降级（pro_bar -> daily）
 */
import pLimit from "p-limit";

const TUSHARE_ENDPOINT = "http://api.tushare.pro";
const limit = pLimit(5); // 默认最多 5 个并发

export interface TushareResponse<T = unknown> {
  request_id: string;
  code: number;
  msg: string | null;
  data: {
    fields: string[];
    items: T[][];
  } | null;
}

export class TushareError extends Error {
  code: number;
  apiName: string;
  constructor(apiName: string, code: number, msg: string) {
    super(`[Tushare:${apiName}] code=${code} ${msg}`);
    this.code = code;
    this.apiName = apiName;
  }
}

function getToken(): string {
  const token = process.env.TUSHARE_TOKEN;
  if (!token) {
    throw new Error(
      "缺少 TUSHARE_TOKEN 环境变量。请到 https://tushare.pro/register 注册后将 token 写入 .env"
    );
  }
  return token;
}

/**
 * 行式数据（fields + items）转对象数组
 */
function rowsToObjects<T>(
  data: { fields: string[]; items: unknown[][] } | null
): T[] {
  if (!data || !data.items) return [];
  const { fields, items } = data;
  return items.map((row) => {
    const obj: Record<string, unknown> = {};
    fields.forEach((f, i) => {
      obj[f] = row[i];
    });
    return obj as T;
  });
}

/**
 * 通用调用：自动重试（429/限频指数退避）
 */
async function call<T>(
  apiName: string,
  params: Record<string, unknown> = {},
  fields = "",
  retry = 3
): Promise<T[]> {
  return limit(async () => {
    let attempt = 0;
    while (true) {
      attempt++;
      const resp = await fetch(TUSHARE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_name: apiName,
          token: getToken(),
          params,
          fields,
        }),
        // 关闭 Next.js 服务端请求缓存，由我们自己的 DB 缓存兜底
        cache: "no-store",
      });

      if (!resp.ok) {
        if (attempt < retry && (resp.status === 429 || resp.status >= 500)) {
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
        throw new TushareError(apiName, resp.status, `HTTP ${resp.status}`);
      }

      const json = (await resp.json()) as TushareResponse;
      if (json.code !== 0) {
        // Tushare 限频错误码常见为 40203 / -2002，本地重试一下
        const msg = json.msg ?? "unknown";
        const isThrottled =
          json.code === 40203 ||
          json.code === -2002 ||
          /频次|频率|每分钟/.test(msg);
        if (attempt < retry && isThrottled) {
          await sleep(2000 * 2 ** (attempt - 1));
          continue;
        }
        throw new TushareError(apiName, json.code, msg);
      }
      return rowsToObjects<T>(json.data);
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================================
// 业务接口
// ============================================================================

export interface TushareStockBasic {
  ts_code: string;
  symbol: string;
  name: string;
  area?: string;
  industry?: string;
  market?: string;
  list_date?: string;
}

/**
 * 拉取股票列表（默认仅上市状态）
 */
export async function fetchStockBasic(
  exchange: "" | "SSE" | "SZSE" | "BSE" = ""
): Promise<TushareStockBasic[]> {
  return call<TushareStockBasic>(
    "stock_basic",
    { exchange, list_status: "L" },
    "ts_code,symbol,name,area,industry,market,list_date"
  );
}

export interface TushareTradeCal {
  exchange: string;
  cal_date: string; // YYYYMMDD
  is_open: number; // 1=交易日
  pretrade_date?: string;
}

/**
 * 拉取交易日历
 * @param startDate YYYYMMDD
 * @param endDate YYYYMMDD
 */
export async function fetchTradeCal(
  startDate: string,
  endDate: string,
  exchange: "SSE" | "SZSE" = "SSE"
): Promise<TushareTradeCal[]> {
  return call<TushareTradeCal>(
    "trade_cal",
    { exchange, start_date: startDate, end_date: endDate },
    "exchange,cal_date,is_open,pretrade_date"
  );
}

export interface TushareDaily {
  ts_code: string;
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  pre_close?: number;
  change?: number;
  pct_chg?: number;
  vol: number; // 成交量（手）
  amount: number; // 成交额（千元）
}

/**
 * 拉取前复权日线（pro_bar，需要 2000 积分）
 * 失败时会自动尝试 daily 接口（不复权，仅作为兜底）
 * @param tsCode 600519.SH
 * @param startDate YYYYMMDD
 * @param endDate YYYYMMDD
 */
export async function fetchKlineQfq(
  tsCode: string,
  startDate: string,
  endDate: string
): Promise<TushareDaily[]> {
  try {
    const rows = await call<TushareDaily>(
      "pro_bar",
      {
        ts_code: tsCode,
        start_date: startDate,
        end_date: endDate,
        adj: "qfq",
        freq: "D",
        asset: "E",
      },
      ""
    );
    return rows.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  } catch (err) {
    if (err instanceof TushareError && (err.code === 40005 || err.code === 40004)) {
      // 积分不足 -> 退化用 daily（不复权）
      console.warn(`[tushare] pro_bar 积分不足，回退 daily: ${tsCode}`);
      const rows = await call<TushareDaily>(
        "daily",
        { ts_code: tsCode, start_date: startDate, end_date: endDate },
        "ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount"
      );
      return rows.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    }
    throw err;
  }
}

/**
 * 当天/最近一日的 daily_basic（市值/换手率等）
 */
export interface TushareDailyBasic {
  ts_code: string;
  trade_date: string;
  turnover_rate?: number;
  pe?: number;
  pb?: number;
  total_mv?: number; // 总市值（万元）
  circ_mv?: number; // 流通市值（万元）
}

export async function fetchDailyBasic(
  tradeDate: string
): Promise<TushareDailyBasic[]> {
  return call<TushareDailyBasic>(
    "daily_basic",
    { trade_date: tradeDate },
    "ts_code,trade_date,turnover_rate,pe,pb,total_mv,circ_mv"
  );
}

/**
 * 腾讯财经免费接口客户端（无需 token）
 *
 * 数据源：
 *   - 日 K 线（前复权）：https://web.ifzq.gtimg.cn/appstock/app/fqkline/get
 *   - 实时报价（兼名称）：https://qt.gtimg.cn/q=sh600519
 *
 * 与 Chrome 扩展 stock-screener-ext/src/api.js 同源，行为已经过实战验证。
 */
import pLimit from "p-limit";
import { toTencentCode } from "./universe";

// 腾讯接口比较友好；过高会被短暂限流。8 是经验上较稳的并发上限。
const limit = pLimit(Number(process.env.TENCENT_CONCURRENCY ?? 8));

export interface TencentDailyBar {
  date: string; // YYYYMMDD（已转换）
  open: number;
  close: number;
  high: number;
  low: number;
  vol: number; // 单位：手
  amount: number; // 单位：千元（兜底为 0）
}

export class TencentApiError extends Error {
  constructor(public code: string, msg: string) {
    super(`[Tencent:${code}] ${msg}`);
  }
}

/**
 * 获取日 K 线（前复权，最近 count 个交易日）
 *
 * @param tsCode 例如 "600519.SH"（也接受 "sh600519"）
 * @param count 拉取条数，默认 400
 * @param endDate YYYYMMDD，可选；不传则拉到最新
 */
export async function fetchTencentKline(
  tsCode: string,
  count = 400,
  endDate = ""
): Promise<TencentDailyBar[]> {
  return limit(async () => {
    const code = toTencentCode(tsCode);
    const end = endDate ? formatTencentDate(endDate) : "";
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,${end},${count},qfq`;

    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new TencentApiError("HTTP", `${resp.status}`);
    const text = await resp.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new TencentApiError("PARSE", "返回非 JSON");
    }
    const obj = json as {
      code: number;
      msg?: string;
      data?: Record<string, { qfqday?: unknown[][]; day?: unknown[][] }>;
    };
    if (obj.code !== 0) {
      throw new TencentApiError(String(obj.code), obj.msg ?? "unknown");
    }
    const block = obj.data?.[code];
    if (!block) throw new TencentApiError("NODATA", `无数据: ${code}`);
    const rows = block.qfqday ?? block.day ?? [];
    if (!rows.length) return [];

    // 行格式：[date, open, close, high, low, volume, ...]
    return rows
      .map((row): TencentDailyBar | null => {
        const date = String(row[0]).replace(/-/g, "");
        if (date.length !== 8) return null;
        const open = Number(row[1]);
        const close = Number(row[2]);
        const high = Number(row[3]);
        const low = Number(row[4]);
        const vol = Number(row[5]);
        if (![open, close, high, low].every(Number.isFinite)) return null;
        return {
          date,
          open,
          close,
          high,
          low,
          vol,
          // 腾讯日 K 不直接给成交额，置 0；规则引擎当前未用到 amount
          amount: 0,
        };
      })
      .filter((x): x is TencentDailyBar => x !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
  });
}

/**
 * 通过实时报价接口获取股票名称（用于自定义代码、未在内置池的情况）
 * 返回 null 表示查不到。
 */
export async function fetchTencentQuote(
  tsCode: string
): Promise<{ name: string; close: number; market: "SH" | "SZ" | "BJ" } | null> {
  return limit(async () => {
    const code = toTencentCode(tsCode);
    const url = `https://qt.gtimg.cn/q=${code}`;
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) return null;
    // 返回类似 v_sh600519="1~贵州茅台~600519~1685.90~..."; 这种 JS 文本
    const text = await resp.text();
    const m = text.match(/="([^"]+)"/);
    if (!m) return null;
    const fields = m[1].split("~");
    if (fields.length < 5) return null;
    const market = (code.startsWith("sh")
      ? "SH"
      : code.startsWith("sz")
        ? "SZ"
        : "BJ") as "SH" | "SZ" | "BJ";
    return {
      name: fields[1],
      close: Number(fields[3]),
      market,
    };
  });
}

function formatTencentDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

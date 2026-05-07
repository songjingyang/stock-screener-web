/**
 * 中金所（CFFEX）期货前 20 会员持仓排名抓取与解析（免费、无 token）
 *
 * 接口（盘后大约 17:00 后更新）：
 *   http://www.cffex.com.cn/sj/ccpm/{YYYYMM}/{DD}/{品种}.xml
 *   品种：
 *     股指期货  IF / IH / IC / IM
 *     国债期货  TS / TF / T  / TL
 *   返回 XML 中所有当日上市合约（如 IF2505、IF2506、IF2509、IF2512）的：
 *     datatypeid=0 成交量排名
 *     datatypeid=1 多头持仓排名（多单）
 *     datatypeid=2 空头持仓排名（空单）
 *
 * 用途：
 *   - "机构多空单" 通常指股指期货 IF（沪深 300）前 20 会员持仓
 *   - "央妈多空单" 通常指国债期货 T（10 年期）前 20 会员持仓
 */

export type CffexProduct =
  | "IF" | "IH" | "IC" | "IM"  // 股指期货
  | "TS" | "TF" | "T"  | "TL"; // 国债期货

export interface MemberPosition {
  rank: number;
  shortname: string;
  volume: number;
  /** 较前一交易日变化（正 = 加仓，负 = 减仓） */
  varvolume: number;
  partyid?: string;
}

export interface ContractPositions {
  instrumentId: string;     // 例如 "IF2505"
  tradingDay: string;       // YYYYMMDD
  longs: MemberPosition[];  // datatypeid=1
  shorts: MemberPosition[]; // datatypeid=2
  /** 前 20 多头总持仓 */
  longTotal: number;
  /** 前 20 空头总持仓 */
  shortTotal: number;
  /** 多头较昨日总变化 */
  longVarTotal: number;
  /** 空头较昨日总变化 */
  shortVarTotal: number;
}

export interface ProductSnapshot {
  product: CffexProduct;
  /** 数据所属交易日 YYYYMMDD（已经回退到最近的有效交易日） */
  tradingDay: string;
  /** 当日所有上市合约的多空持仓 */
  contracts: ContractPositions[];
  /** 用于 UI 默认展示的"主力合约"（前 20 多头总持仓最大者，通常即近月） */
  dominant?: ContractPositions;
}

// ----------------------------------------------------------------------------
// 解析 XML（用最简单的正则，避免依赖 xml 解析包）
// ----------------------------------------------------------------------------

interface RawDatum {
  instrumentid: string;
  tradingday: string;
  datatypeid: string;
  rank: number;
  shortname: string;
  volume: number;
  varvolume: number;
  partyid: string;
}

function parseXml(xml: string): RawDatum[] {
  const out: RawDatum[] = [];
  const blockRe = /<data\b[^>]*>([\s\S]*?)<\/data>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml))) {
    const block = m[1];
    const tag = (t: string): string => {
      const r = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(block);
      return r ? r[1].trim() : "";
    };
    out.push({
      instrumentid: tag("instrumentid"),
      tradingday: tag("tradingday"),
      datatypeid: tag("datatypeid"),
      rank: parseInt(tag("rank"), 10) || 0,
      shortname: tag("shortname"),
      volume: parseInt(tag("volume"), 10) || 0,
      varvolume: parseInt(tag("varvolume"), 10) || 0,
      partyid: tag("partyid"),
    });
  }
  return out;
}

function aggregate(items: RawDatum[]): ContractPositions[] {
  const byInstr = new Map<string, RawDatum[]>();
  for (const it of items) {
    if (!it.instrumentid) continue;
    let arr = byInstr.get(it.instrumentid);
    if (!arr) {
      arr = [];
      byInstr.set(it.instrumentid, arr);
    }
    arr.push(it);
  }
  const out: ContractPositions[] = [];
  for (const [instrumentId, list] of byInstr) {
    const longs = list
      .filter((x) => x.datatypeid === "1")
      .sort((a, b) => a.rank - b.rank)
      .map((x) => ({
        rank: x.rank,
        shortname: x.shortname,
        volume: x.volume,
        varvolume: x.varvolume,
        partyid: x.partyid,
      }));
    const shorts = list
      .filter((x) => x.datatypeid === "2")
      .sort((a, b) => a.rank - b.rank)
      .map((x) => ({
        rank: x.rank,
        shortname: x.shortname,
        volume: x.volume,
        varvolume: x.varvolume,
        partyid: x.partyid,
      }));
    if (!longs.length && !shorts.length) continue;
    const sum = (xs: { volume: number }[]) => xs.reduce((s, x) => s + x.volume, 0);
    const sumVar = (xs: { varvolume: number }[]) =>
      xs.reduce((s, x) => s + x.varvolume, 0);
    out.push({
      instrumentId,
      tradingDay: list[0].tradingday,
      longs,
      shorts,
      longTotal: sum(longs),
      shortTotal: sum(shorts),
      longVarTotal: sumVar(longs),
      shortVarTotal: sumVar(shorts),
    });
  }
  // 按合约号升序（近月在前）
  return out.sort((a, b) => a.instrumentId.localeCompare(b.instrumentId));
}

// ----------------------------------------------------------------------------
// 日期回退：今日找不到则回退到上一交易日
// ----------------------------------------------------------------------------

function shanghaiTodayStr(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // YYYY-MM-DD
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

async function fetchOneDay(
  product: CffexProduct,
  ymd: string,
  timeoutMs: number
): Promise<RawDatum[] | null> {
  const [y, m, d] = ymd.split("-");
  const url = `http://www.cffex.com.cn/sj/ccpm/${y}${m}/${d}/${product}.xml`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      cache: "no-store",
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0" },
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    if (!text || !text.includes("<data")) return null;
    const items = parseXml(text);
    return items.length ? items : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchPositionsOptions {
  /** 最多回溯天数（应对节假日 / 当日盘后未发布），默认 7 */
  maxBackoff?: number;
  /** 单次抓取超时，默认 6000 ms */
  timeoutMs?: number;
}

/**
 * 拉取指定品种当日（或最近一个交易日）的多空持仓数据。
 *
 * 失败 / 没数据时返回 null（应由调用方降级显示）。
 */
export async function fetchCffexPositions(
  product: CffexProduct,
  opts: FetchPositionsOptions = {}
): Promise<ProductSnapshot | null> {
  const maxBackoff = opts.maxBackoff ?? 7;
  const timeoutMs = opts.timeoutMs ?? 6000;
  const today = shanghaiTodayStr();

  for (let i = 0; i < maxBackoff; i++) {
    const ymd = offsetDate(today, -i);
    const items = await fetchOneDay(product, ymd, timeoutMs);
    if (items) {
      const contracts = aggregate(items);
      // 选 longTotal 最大的合约作为"主力"，通常就是近月
      const dominant = contracts.length
        ? [...contracts].sort((a, b) => b.longTotal - a.longTotal)[0]
        : undefined;
      return {
        product,
        tradingDay: items[0].tradingday,
        contracts,
        dominant,
      };
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// UI 复用工具
// ----------------------------------------------------------------------------

/**
 * 计算"净持仓倾向"：净空 / 净多 / 平衡
 */
export function netSentiment(c: ContractPositions): {
  net: number; // 多 - 空（正 = 净多）
  netPct: number; // 净 / (多+空)，[-1, 1]
  bias: "long" | "short" | "balanced";
  label: string;
} {
  const net = c.longTotal - c.shortTotal;
  const total = c.longTotal + c.shortTotal;
  const netPct = total > 0 ? net / total : 0;
  let bias: "long" | "short" | "balanced" = "balanced";
  if (netPct > 0.05) bias = "long";
  else if (netPct < -0.05) bias = "short";
  return {
    net,
    netPct,
    bias,
    label:
      bias === "long" ? "净多偏强" : bias === "short" ? "净空偏强" : "多空均衡",
  };
}

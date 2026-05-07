/**
 * 个股公告 / 重大事项 抓取（东方财富免费 API）
 *
 * 接口（无 token、无登录）：
 *   https://np-anotice-stock.eastmoney.com/api/security/ann
 *     ?stock_list=600519
 *     &page_size=20&page_index=1
 *     &ann_type=A     // A 股
 *     &sr=-1          // 按时间降序
 *
 * 重要性自动分级：
 *   high  停复牌 / ST / 退市 / 风险警示 / 立案调查 / 业绩亏损 / 大额商誉减值
 *   med   业绩预告 / 定期报告 / 分红派息 / 增发 / 限售解禁 / 收购 / 重大资产
 *   low   股东大会 / 关联交易 / 提示性 / 其他
 */

const API_BASE =
  "https://np-anotice-stock.eastmoney.com/api/security/ann";

export type AnnLevel = "high" | "med" | "low";

export interface Announcement {
  /** 文章编号，可拼接东方财富详情页 */
  artCode: string;
  title: string;
  /** YYYY-MM-DD HH:mm */
  noticeDate: string;
  /** 东方财富给的公告分类（已扁平为字符串数组） */
  columns: string[];
  /** 自动判断的重要性 */
  level: AnnLevel;
  /** 详情页链接（东方财富） */
  url: string;
}

interface RawItem {
  art_code: string;
  title: string;
  notice_date: string;
  columns?: Array<{ column_code: string; column_name: string }>;
  codes?: Array<{ stock_code: string }>;
}

interface RawResp {
  data?: { list?: RawItem[] };
}

// 重要：会显著影响股价的事件（停复牌 / 退市风险 / 业绩亏损 / 重大重组）
const HIGH_KEYWORDS = [
  "停牌",
  "复牌",
  "*ST",
  "退市",
  "风险警示",
  "立案",
  "亏损",
  "商誉减值",
  "重大违法",
  "重大资产重组",
  "破产",
  "暂停上市",
  "终止上市",
];

// 关注：日常但需要留意的事件（业绩 / 分红 / 增发 / 解禁 / 收购等）
const MED_KEYWORDS = [
  "业绩预告",
  "业绩快报",
  "年度报告",
  "季度报告",
  "半年度报告",
  "一季度报告",
  "三季度报告",
  "分红",
  "派息",
  "送转",
  "利润分配",
  "增发",
  "配股",
  "配售",
  "回购",
  "减持",
  "增持",
  "解禁",
  "限售",
  "收购",
  "并购",
  "出售资产",
  "购买资产",
  "中标",
  "重大合同",
];

function classifyLevel(title: string): AnnLevel {
  // 关键字基于标题，不依赖东财的 column_code（含义不透明，易误判）
  for (const k of HIGH_KEYWORDS) if (title.includes(k)) return "high";
  for (const k of MED_KEYWORDS) if (title.includes(k)) return "med";
  return "low";
}

/** 把 tsCode (600519.SH) 转换为东财 API 需要的 stock_list 参数（纯 6 位数字） */
function symbolOnly(tsCode: string): string {
  return tsCode.replace(/\.[A-Z]+$/i, "");
}

export interface FetchAnnouncementsOptions {
  /** 截取条数，默认 12 */
  limit?: number;
  /** 抓取超时（毫秒），默认 8000 */
  timeoutMs?: number;
}

/**
 * 拉取指定个股最近 N 条公告。
 * 失败时返回空数组（接口偶发异常时不影响整页渲染）。
 */
export async function fetchAnnouncements(
  tsCode: string,
  opts: FetchAnnouncementsOptions = {}
): Promise<Announcement[]> {
  const limit = opts.limit ?? 12;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const sym = symbolOnly(tsCode);
  if (!/^\d{6}$/.test(sym)) return [];

  const url =
    `${API_BASE}?sr=-1` +
    `&page_size=${Math.max(limit * 2, 20)}` +
    `&page_index=1` +
    `&ann_type=A` +
    `&client_source=web` +
    `&stock_list=${sym}`;

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
    if (!resp.ok) return [];
    const json = (await resp.json()) as RawResp;
    const list = json?.data?.list ?? [];

    const out: Announcement[] = [];
    for (const it of list) {
      const cols = it.columns ?? [];
      const colNames = cols.map((c) => c.column_name);
      const noticeDate = (it.notice_date || "").slice(0, 16).replace("T", " ");
      out.push({
        artCode: it.art_code,
        title: it.title,
        noticeDate,
        columns: colNames,
        level: classifyLevel(it.title),
        url: `https://np-cnotice-stock.eastmoney.com/api/content/ann?art_code=${it.art_code}&client_source=web&page_index=1`,
      });
    }
    return out.slice(0, limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** 把 level 翻成中文标签（UI 复用） */
export function levelLabel(level: AnnLevel): string {
  return level === "high" ? "重要" : level === "med" ? "关注" : "一般";
}

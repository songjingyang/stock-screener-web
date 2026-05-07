/**
 * 全 A 股列表抓取（免费、无需 token）
 *
 * 数据源：新浪财经 Market_Center
 *   GET https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData
 *     ?page=N&num=100&sort=symbol&asc=1&node=hs_a
 *
 * 节点说明：
 *   hs_a   沪深 A 股（含主板/创业板/科创板，约 5500 只）
 *   sh_a   仅沪市 A 股
 *   sz_a   仅深市 A 股
 *
 * 注意：北交所列表新浪不在此节点，先不覆盖；如有需要后续可加 endpoint。
 */
import pLimit from "p-limit";
import { inferMarket } from "./universe";

export interface RemoteStock {
  tsCode: string; // 600519.SH
  symbol: string; // 600519
  name: string;
  market: "SH" | "SZ" | "BJ";
}

export interface IndustryNode {
  /** 行业名称，例如 "白酒行业" */
  name: string;
  /** 节点 ID，例如 "new_blhy" */
  node: string;
}

const SINA_BASE =
  "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData";

const limit = pLimit(4);

/**
 * 拉取全 A 股列表（沪深，约 5500 只）
 *
 * @param onProgress 进度回调（页索引、总页数）
 */
export async function fetchAllAStocks(
  onProgress?: (loaded: number, total: number) => void
): Promise<RemoteStock[]> {
  const pageSize = 100;
  const node = "hs_a";

  const first = await fetchPage(node, 1, pageSize);
  const all: RemoteStock[] = [...first];
  if (first.length < pageSize) {
    onProgress?.(all.length, all.length);
    return dedupe(all);
  }

  // 探测末页：固定上限 80 页（够 8000 只），到达空页停止
  const maxPage = 80;
  const tasks: Array<Promise<void>> = [];
  for (let p = 2; p <= maxPage; p++) {
    tasks.push(
      limit(async () => {
        const list = await fetchPage(node, p, pageSize);
        if (list.length === 0) return;
        all.push(...list);
        onProgress?.(all.length, all.length);
      })
    );
  }
  await Promise.all(tasks);

  return dedupe(all);
}

async function fetchPage(
  node: string,
  page: number,
  num: number
): Promise<RemoteStock[]> {
  const url = `${SINA_BASE}?page=${page}&num=${num}&sort=symbol&asc=1&node=${node}`;
  const resp = await fetch(url, {
    cache: "no-store",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
      referer: "https://finance.sina.com.cn/",
    },
  });
  if (!resp.ok) throw new Error(`sina HTTP ${resp.status}`);
  const text = await resp.text();
  // 接口偶发返回 "null" / 空数组
  if (!text || text === "null") return [];

  let data: Array<Record<string, unknown>>;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const out: RemoteStock[] = [];
  for (const item of data) {
    const symbol = String(item.code ?? "").trim();
    if (!/^\d{6}$/.test(symbol)) continue;
    const market = inferMarket(symbol);
    if (!market) continue;
    out.push({
      tsCode: `${symbol}.${market}`,
      symbol,
      name: String(item.name ?? symbol).trim(),
      market,
    });
  }
  return out;
}

function dedupe(list: RemoteStock[]): RemoteStock[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    if (seen.has(s.tsCode)) return false;
    seen.add(s.tsCode);
    return true;
  });
}

// ============================================================================
// 行业映射
// ============================================================================

const NODES_URL =
  "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodes";

/**
 * 拉取行业节点列表
 *
 * 优先级：
 *   申万一级（sw1_*，31 个，覆盖全 A 股，最权威）→ 失败回退 → 新浪行业（new_*，48 个，老分类）
 *
 * 申万一级示例：电子 / 电力设备 / 食品饮料 / 医药生物 / 计算机 / 国防军工 …
 */
export async function fetchIndustryNodes(): Promise<IndustryNode[]> {
  const resp = await fetch(NODES_URL, {
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0", referer: "https://finance.sina.com.cn/" },
  });
  if (!resp.ok) throw new Error(`sina nodes HTTP ${resp.status}`);
  const text = await resp.text();
  let tree: unknown;
  try {
    tree = JSON.parse(text);
  } catch {
    throw new Error("sina nodes 非 JSON");
  }

  const tuples: Array<{ name: string; node: string }> = [];
  function walk(n: unknown) {
    if (!Array.isArray(n)) return;
    if (
      n.length === 3 &&
      typeof n[0] === "string" &&
      typeof n[2] === "string"
    ) {
      tuples.push({ name: n[0] as string, node: n[2] as string });
      return;
    }
    for (const c of n) walk(c);
  }
  walk(tree);

  const sw1 = tuples.filter((t) => /^sw1_/.test(t.node));
  if (sw1.length >= 20) return sw1;
  return tuples.filter((t) => /^new_/.test(t.node));
}

/**
 * 拉取一个行业节点下的全部股票代码（自动翻页）
 */
async function fetchStocksOfIndustry(
  nodeId: string
): Promise<Array<{ tsCode: string }>> {
  const pageSize = 100;
  const out: Array<{ tsCode: string }> = [];
  for (let page = 1; page <= 20; page++) {
    const list = await fetchPage(nodeId, page, pageSize);
    if (!list.length) break;
    for (const s of list) out.push({ tsCode: s.tsCode });
    if (list.length < pageSize) break;
  }
  return out;
}

/**
 * 构造 tsCode → industry 映射（一次同步约 5~15 秒）
 *
 * 注意：少数股票（特别是新股、ST 股）可能在新浪行业分类里查不到，
 * 此时返回的 Map 中无对应键，调用方按 undefined 处理。
 */
export async function fetchAllIndustryMap(
  onProgress?: (done: number, total: number, currentName: string) => void
): Promise<Map<string, string>> {
  const nodes = await fetchIndustryNodes();
  const map = new Map<string, string>();

  let done = 0;
  await Promise.all(
    nodes.map((n) =>
      limit(async () => {
        try {
          const stocks = await fetchStocksOfIndustry(n.node);
          for (const s of stocks) {
            // 取首次出现的行业（一只票通常只属于一个行业，但偶有重叠）
            if (!map.has(s.tsCode)) map.set(s.tsCode, n.name);
          }
        } catch (err) {
          console.warn(`[industry] ${n.name} 拉取失败:`, (err as Error).message);
        }
        done++;
        onProgress?.(done, nodes.length, n.name);
      })
    )
  );

  return map;
}

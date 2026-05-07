/**
 * 股票池：内置精选标的 + 代码格式工具
 * 设计：腾讯/通用 6 位代码 ⇄ Tushare ts_code（如 600519.SH）双向转换。
 */

export interface BuiltinStock {
  tsCode: string;
  symbol: string;
  name: string;
  market: "SH" | "SZ" | "BJ";
  industry?: string;
}

/**
 * 由 6 位股票代码推断市场后缀（A 股规则）
 *  - 6 开头 → SH（沪 A 主板 600/601/603/605/688）
 *  - 0/2/3 开头 → SZ（深 A：000/001/002/003/300/301）
 *  - 4/8 开头 → BJ（北交所老规则）
 *  - 9 开头：92xxxx 是北交所新规则；900xxx 是沪 B 股（极少且老化）
 *    简单处理：9 开头一律视作 BJ
 */
export function inferMarket(symbol: string): "SH" | "SZ" | "BJ" | null {
  const s = symbol.trim();
  if (!/^\d{6}$/.test(s)) return null;
  const head = s[0];
  if (head === "6") return "SH";
  if (head === "0" || head === "2" || head === "3") return "SZ";
  if (head === "4" || head === "8" || head === "9") return "BJ";
  return null;
}

/**
 * 由 6 位代码推断所属板块（A 股交易所板块分类）
 *
 * 沪市：
 *   600/601/603/605 -> 沪市主板
 *   688/689        -> 科创板
 *   900            -> 沪 B 股（已老化，少量保留）
 * 深市：
 *   000/001         -> 深市主板
 *   002            -> 中小板（已合并主板，代码段保留）
 *   003            -> 主板（中小板合并后新增段）
 *   300/301        -> 创业板
 *   200            -> 深 B 股
 * 北交所：
 *   8/4/9 (除 9XX 沪 B) -> 北交所
 */
export function inferBoard(symbol: string): string {
  const s = symbol.trim();
  if (!/^\d{6}$/.test(s)) return "未知";
  const p2 = s.slice(0, 2);
  const p3 = s.slice(0, 3);

  // 沪市
  if (["600", "601", "603", "605"].includes(p3)) return "沪市主板";
  if (p3 === "688" || p3 === "689") return "科创板";
  if (p3 === "900") return "沪 B 股";

  // 深市
  if (p3 === "000" || p3 === "001") return "深市主板";
  if (p3 === "002") return "中小板";
  if (p3 === "003") return "深市主板";
  if (p3 === "300" || p3 === "301" || p3 === "302") return "创业板";
  if (p3 === "200") return "深 B 股";

  // 北交所
  if (p2 === "92" || p2 === "83" || p2 === "87" || p2 === "88") return "北交所";
  if (s[0] === "4") return "北交所";
  if (s[0] === "8") return "北交所";

  return "其它";
}

/**
 * 把 ts_code（如 "600519.SH"）转成腾讯前缀格式（如 "sh600519"）
 */
export function toTencentCode(tsCode: string): string {
  const m = tsCode.match(/^(\d{6})\.(SH|SZ|BJ)$/i);
  if (!m) return tsCode.toLowerCase();
  return `${m[2].toLowerCase()}${m[1]}`;
}

/**
 * 标准化用户输入：返回 Tushare 风格的 ts_code（如 "600519.SH"）
 * 接受 "sh600519" / "600519.SH" / "600519" 等多种形式
 */
export function toTsCode(input: string): string | null {
  if (!input) return null;
  const raw = String(input).trim().toUpperCase();
  // 已是 ts_code 形式
  if (/^\d{6}\.(SH|SZ|BJ)$/.test(raw)) return raw;
  // 腾讯前缀形式
  const m1 = raw.match(/^(SH|SZ|BJ)(\d{6})$/);
  if (m1) return `${m1[2]}.${m1[1]}`;
  // 纯 6 位
  const m2 = raw.match(/^\d{6}$/);
  if (m2) {
    const market = inferMarket(raw);
    return market ? `${raw}.${market}` : null;
  }
  return null;
}

/**
 * 内置精选股票池（迁移自 stock-screener-ext/data/stockPool.js，去重后转 Tushare 格式）
 * 用作低积分账号的演示用股票池，不依赖 Tushare 拉全市场列表。
 */
const RAW_POOL: Array<{ code: string; name: string; industry?: string }> = [
  // 银行
  { code: "sh600036", name: "招商银行", industry: "银行" },
  { code: "sh601398", name: "工商银行", industry: "银行" },
  { code: "sh601288", name: "农业银行", industry: "银行" },
  { code: "sh601988", name: "中国银行", industry: "银行" },
  { code: "sh601939", name: "建设银行", industry: "银行" },
  { code: "sh600000", name: "浦发银行", industry: "银行" },
  { code: "sh601166", name: "兴业银行", industry: "银行" },
  { code: "sz000001", name: "平安银行", industry: "银行" },
  { code: "sh601328", name: "交通银行", industry: "银行" },
  // 保险/券商
  { code: "sh601318", name: "中国平安", industry: "保险" },
  { code: "sh601628", name: "中国人寿", industry: "保险" },
  { code: "sh601336", name: "新华保险", industry: "保险" },
  { code: "sh601601", name: "中国太保", industry: "保险" },
  { code: "sh600030", name: "中信证券", industry: "证券" },
  { code: "sh601688", name: "华泰证券", industry: "证券" },
  { code: "sh600837", name: "海通证券", industry: "证券" },
  { code: "sz000776", name: "广发证券", industry: "证券" },
  { code: "sh601066", name: "中信建投", industry: "证券" },
  { code: "sh600999", name: "招商证券", industry: "证券" },
  // 白酒/食品饮料
  { code: "sh600519", name: "贵州茅台", industry: "白酒" },
  { code: "sz000858", name: "五粮液", industry: "白酒" },
  { code: "sz000568", name: "泸州老窖", industry: "白酒" },
  { code: "sh600809", name: "山西汾酒", industry: "白酒" },
  { code: "sz002304", name: "洋河股份", industry: "白酒" },
  { code: "sh603369", name: "今世缘", industry: "白酒" },
  { code: "sh600600", name: "青岛啤酒", industry: "啤酒" },
  { code: "sh603288", name: "海天味业", industry: "调味品" },
  { code: "sh600887", name: "伊利股份", industry: "乳品" },
  { code: "sz000895", name: "双汇发展", industry: "肉制品" },
  // 医药
  { code: "sh600276", name: "恒瑞医药", industry: "医药" },
  { code: "sh603259", name: "药明康德", industry: "医药" },
  { code: "sh600196", name: "复星医药", industry: "医药" },
  { code: "sz300760", name: "迈瑞医疗", industry: "医疗器械" },
  { code: "sz000538", name: "云南白药", industry: "中药" },
  { code: "sh600436", name: "片仔癀", industry: "中药" },
  { code: "sz300015", name: "爱尔眼科", industry: "医疗服务" },
  { code: "sz300122", name: "智飞生物", industry: "生物制品" },
  // 新能源/锂电
  { code: "sz300750", name: "宁德时代", industry: "锂电" },
  { code: "sz002594", name: "比亚迪", industry: "新能源车" },
  { code: "sz300014", name: "亿纬锂能", industry: "锂电" },
  { code: "sz002460", name: "赣锋锂业", industry: "锂矿" },
  { code: "sz002466", name: "天齐锂业", industry: "锂矿" },
  { code: "sh601012", name: "隆基绿能", industry: "光伏" },
  { code: "sh600438", name: "通威股份", industry: "光伏" },
  { code: "sh601865", name: "福莱特", industry: "光伏玻璃" },
  { code: "sz002129", name: "TCL中环", industry: "光伏" },
  // 半导体
  { code: "sh688981", name: "中芯国际", industry: "半导体" },
  { code: "sh600584", name: "长电科技", industry: "半导体" },
  { code: "sz002371", name: "北方华创", industry: "半导体" },
  { code: "sh688012", name: "中微公司", industry: "半导体" },
  { code: "sh688008", name: "澜起科技", industry: "半导体" },
  { code: "sz300782", name: "卓胜微", industry: "半导体" },
  { code: "sh603160", name: "汇顶科技", industry: "半导体" },
  { code: "sz002049", name: "紫光国微", industry: "半导体" },
  { code: "sh688041", name: "海光信息", industry: "半导体" },
  // 消费电子/通信
  { code: "sz002475", name: "立讯精密", industry: "消费电子" },
  { code: "sz000725", name: "京东方A", industry: "面板" },
  { code: "sh600745", name: "闻泰科技", industry: "消费电子" },
  { code: "sz002241", name: "歌尔股份", industry: "消费电子" },
  { code: "sz000063", name: "中兴通讯", industry: "通信" },
  { code: "sh600050", name: "中国联通", industry: "通信" },
  // 汽车
  { code: "sh600104", name: "上汽集团", industry: "汽车" },
  { code: "sh601238", name: "广汽集团", industry: "汽车" },
  { code: "sh601633", name: "长城汽车", industry: "汽车" },
  { code: "sh600066", name: "宇通客车", industry: "客车" },
  // 互联网/软件
  { code: "sh600570", name: "恒生电子", industry: "金融科技" },
  { code: "sh600588", name: "用友网络", industry: "软件" },
  { code: "sz002230", name: "科大讯飞", industry: "AI" },
  { code: "sh603444", name: "吉比特", industry: "游戏" },
  { code: "sh601360", name: "三六零", industry: "互联网" },
  { code: "sh600536", name: "中国软件", industry: "软件" },
  { code: "sz300059", name: "东方财富", industry: "互联网券商" },
  // 家电
  { code: "sz000333", name: "美的集团", industry: "家电" },
  { code: "sh600690", name: "海尔智家", industry: "家电" },
  { code: "sz000651", name: "格力电器", industry: "家电" },
  { code: "sz002508", name: "老板电器", industry: "家电" },
  // 周期/资源
  { code: "sh601857", name: "中国石油", industry: "石油" },
  { code: "sh600028", name: "中国石化", industry: "石油" },
  { code: "sh601088", name: "中国神华", industry: "煤炭" },
  { code: "sh601225", name: "陕西煤业", industry: "煤炭" },
  { code: "sh600188", name: "兖矿能源", industry: "煤炭" },
  { code: "sh600547", name: "山东黄金", industry: "黄金" },
  { code: "sh600362", name: "江西铜业", industry: "有色" },
  { code: "sh600111", name: "北方稀土", industry: "稀土" },
  { code: "sh600219", name: "南山铝业", industry: "有色" },
  { code: "sh603799", name: "华友钴业", industry: "有色" },
  // 基建/地产
  { code: "sh601668", name: "中国建筑", industry: "基建" },
  { code: "sh601390", name: "中国中铁", industry: "基建" },
  { code: "sh601186", name: "中国铁建", industry: "基建" },
  { code: "sz000002", name: "万科A", industry: "地产" },
  { code: "sh600048", name: "保利发展", industry: "地产" },
  // 公用事业
  { code: "sh600900", name: "长江电力", industry: "水电" },
  { code: "sh601985", name: "中国核电", industry: "核电" },
  { code: "sh600886", name: "国投电力", industry: "电力" },
  // 军工
  { code: "sh600760", name: "中航沈飞", industry: "军工" },
  { code: "sh600893", name: "航发动力", industry: "军工" },
  // 其它
  { code: "sh603833", name: "欧派家居", industry: "家居" },
  { code: "sz002714", name: "牧原股份", industry: "养殖" },
  { code: "sh600009", name: "上海机场", industry: "机场" },
  { code: "sh601888", name: "中国中免", industry: "免税" },
];

export const BUILTIN_POOL: BuiltinStock[] = (() => {
  const seen = new Set<string>();
  const out: BuiltinStock[] = [];
  for (const item of RAW_POOL) {
    const tsCode = toTsCode(item.code);
    if (!tsCode) continue;
    if (seen.has(tsCode)) continue;
    seen.add(tsCode);
    const symbol = tsCode.slice(0, 6);
    const market = tsCode.slice(7) as "SH" | "SZ" | "BJ";
    out.push({ tsCode, symbol, name: item.name, market, industry: item.industry });
  }
  return out;
})();

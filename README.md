# 右侧交易高胜率筛选器（Next.js 全栈版）

> 基于多指标共振体系的 A 股右侧买点扫描、单股可视化、历史回测与每日定时扫描平台。
> 默认数据源：[腾讯财经免费接口](https://web.ifzq.gtimg.cn)（**无需 token、零配置**）。可选切换：[Tushare Pro](https://tushare.pro/)。
> 技术栈：Next.js 14 App Router · TypeScript · Tailwind · Prisma · lightweight-charts。
>
> ⚠️ 本工具仅供学习研究，不构成任何投资建议。

## 功能一览

| 模块 | 说明 |
| --- | --- |
| 多策略筛选 | 内置「三指标共振」「强势缩量回踩」「平台突破」「全指标共振（高胜率）」4 个预设策略 |
| 高胜率指标体系 | MA 多头 / MA 斜率 / MACD 0 轴上金叉 / RSI 强势 / KDJ 金叉 / 量比 / 缩量回踩 / 平台突破 / N 日新高 / ATR 风控 |
| 单股可视化 | 蜡烛图 + MA5/10/20/60 + 成交量副图 + 命中条件清单 + 各指标实时数值 |
| 历史回测 | 选定区间内逐日扫描，输出胜率、平均收益、最大回撤、收益曲线、明细 |
| 自选股 / 历史扫描 | 一键收藏命中股票；持久化每次扫描结果以便复盘 |
| 每日定时扫描 | Vercel Cron 每个工作日 16:30（北京时间）自动跑全部预设策略并落库 |

## 快速开始（零配置）

```bash
cd stock-screener-web
npm install
cp .env.example .env       # 默认配置即可，无需修改
npm run db:push            # 同步 schema 到本地 SQLite
npm run db:seed            # 写入内置股票池（100 只）+ 4 个预设策略
npm run dev
# 访问 http://localhost:3000
```

打开「筛选」页 → 选择策略 → 点击「开始扫描」即可。

> **不需要 Tushare token**。默认走腾讯财经免费接口，与原 Chrome 扩展同源，开箱即用。

## 扫描全 A 股（5500+ 只）

筛选页的「股票池」下拉中选择「全 A 股」，会出现「↻ 同步全 A 股」按钮：

1. **同步股票列表**（≈ 10 秒）：从新浪财经免费接口拉全 A 股代码与名称（hs_a 节点，含主板/创业板/科创板，约 5500 只），写入 `Stock` 表。仅元数据，不拉 K 线。
2. **首次扫描**（≈ 5-10 分钟）：对每只股票从腾讯免费接口拉日 K 线（前复权，最近 ~250 个交易日），结果存入 `KlineDaily` 表。
3. **再次扫描**（≈ 20 秒）：缓存命中后全市场 4 个策略走一遍只需 20 秒。

实测（缓存命中后）：

```
[平台突破]            4.4s 命中 1/5513
[强势缩量回踩]        4.6s 命中 X/5513
[三指标共振]          4.5s 命中 X/5513
[全指标共振（高胜率）] 4.9s 命中 14/5513   ← 9/9 满分
```

> 部署到 Vercel Hobby 时单次函数限 10 秒，全市场扫描会超时；建议升级 Pro（300 秒），或仅用「内置精选」+「自选」+「自定义」池。

## 数据源切换

| 项 | 默认（腾讯免费） | 可选（Tushare Pro） |
| --- | --- | --- |
| 是否需要注册 | 否 | 是（[注册](https://tushare.pro/register)） |
| 是否需要 token | 否 | 是（≥ 2000 积分推荐） |
| 复权口径 | 前复权（接口端给的口径） | 前复权（pro_bar，更稳定） |
| 全 A 股扫描 | 受限于内置精选/自选/自定义池 | 可拉 `stock_basic` 全量 |
| 限频 | 较友好 | 严格，按积分等级 |

要切到 Tushare Pro，仅需在 `.env` 中设置：

```env
TUSHARE_TOKEN=你的token
```

应用会自动检测并切换数据源（无需改代码）。

## 项目结构

```
stock-screener-web/
├── app/                     # Next.js App Router
│   ├── page.tsx             # 首页：今日命中
│   ├── screen/              # 筛选页（Server Action）
│   ├── stock/[tsCode]/      # 单股详情（K 线 + 指标）
│   ├── backtest/            # 回测
│   ├── watchlist/           # 自选股
│   ├── history/             # 历史扫描
│   └── api/
│       ├── kline/[tsCode]/  # 单股 K 线 JSON
│       └── cron/daily-scan/ # Vercel Cron 入口
├── lib/
│   ├── data/
│   │   ├── tencent.ts       # 腾讯财经免费接口（默认 Provider）
│   │   ├── tushare.ts       # Tushare Pro（配置 token 时启用）
│   │   ├── kline-cache.ts   # DB 优先 + 自动 Provider 选择
│   │   └── universe.ts      # 内置股票池 + 代码格式工具
│   ├── indicators/          # 纯函数：MA/EMA/MACD/RSI/KDJ/BOLL/ATR/量比/突破
│   ├── screener/            # 规则引擎 + 内置预设
│   ├── backtest/            # 简化回测器
│   └── db/prisma.ts         # Prisma 单例
├── prisma/
│   ├── schema.prisma        # SQLite/Postgres 共用 schema
│   └── seed.ts              # 初始化股票池/策略
└── vercel.json              # Cron 配置
```

## 内置策略

| 策略名 | 条件（AND） |
| --- | --- |
| 三指标共振 | 均线多头 + MA20 向上 + MACD 0 轴上 + 3 日内金叉 + 量比 ≥ 1.5 + 突破 20 日新高 |
| 强势缩量回踩 | 均线多头 + MA20 向上 + 缩量回踩 MA20 + RSI ∈ [45,70] |
| 平台突破 | 平台突破（前 20 日振幅 < 8%）+ 量比 ≥ 1.8 + MA60 非下行 |
| 全指标共振（高胜率） | 三共振 + RSI ∈ [50,80] + KDJ 金叉 + ATR/价 ∈ [1%,6%] |

每个策略的具体规则配置存储于 `Strategy.ruleConfig`（JSON），可在 [`lib/screener/presets.ts`](lib/screener/presets.ts) 修改后重新 `npm run db:seed` 同步。

## 部署到 Vercel

本项目 **本地用 SQLite，生产用 Postgres**，由 [`scripts/prepare-prisma.js`](scripts/prepare-prisma.js) 在 build 阶段检测 `VERCEL=1` 自动改写 `schema.prisma` 的 `datasource` 块——你**不需要手工切 schema**。

### 一、CLI 一键部署（推荐）

```bash
# 1. 全局安装 vercel CLI（如已安装可跳过）
npm i -g vercel

# 2. 在项目目录里登录（会打开浏览器）
cd stock-screener-web
vercel login

# 3. 关联或新建项目（首次会问几个问题，全部回车默认即可）
vercel link

# 4. 在 Vercel Dashboard 给项目加一个 Vercel Postgres：
#    项目页 → Storage → Create Database → Postgres → Connect
#    连上后会自动注入 POSTGRES_PRISMA_URL / POSTGRES_URL_NON_POOLING 等环境变量

# 5. 再补一个 CRON_SECRET（用于保护 cron 端点）
vercel env add CRON_SECRET production   # 输入任意强随机串

# 6. 部署
vercel --prod
```

首次构建会自动跑 `prisma db push` 把表结构同步到 Postgres，无需手动操作。

### 二、Web UI 部署（可选）

1. 把仓库推到 GitHub
2. 登录 [vercel.com/new](https://vercel.com/new) → Import 该仓库
3. 项目页 → Storage → Create Database → Postgres
4. Settings → Environment Variables 加 `CRON_SECRET=任意强随机串`（可选 `TUSHARE_TOKEN`）
5. Deployments → Redeploy

### 三、数据初始化

部署成功后，A 股股票池是**空的**。两种方式让它"活"起来：

```bash
# 方式 A：访问 https://你的域名/screen 选择「全 A 股」点【同步全 A 股】（10 秒）
# 方式 B：本地拉取生产 DB URL 后 seed
vercel env pull .env.production.local
DATABASE_URL=$(grep POSTGRES_PRISMA_URL .env.production.local | cut -d= -f2-) npm run db:seed
```

### 四、定时扫描

`vercel.json` 已配置工作日 UTC 08:30（= 北京时间 16:30，收盘后 30 分钟）自动触发 [`/api/cron/daily-scan`](app/api/cron/daily-scan/route.ts)，跑所有预设策略并落库。

> Vercel Hobby 计划单次函数最多 60 秒。全市场扫描首次可能超时——可以先在本地用 `vercel env pull` 拿到生产 DB URL，本地预热完整 K 线缓存（约 5–10 分钟），再让 Cron 在缓存上做日常增量扫描即可保证 < 30 秒。Pro 计划 300 秒上限则无此问题。

## 手动测试 Cron

```bash
curl -H "authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/daily-scan
```

## 与 Chrome 扩展版（[`stock-screener-ext/`](../stock-screener-ext/)）的关系

- **数据源同源**：默认的腾讯免费接口与扩展版的 [`api.js`](../stock-screener-ext/src/api.js) 完全一致。
- **指标算法迁移零改动**：扩展版的 [`indicators.js`](../stock-screener-ext/src/indicators.js) 直接迁移到 TS，仅加类型。
- **三指标共振规则**：表达为本项目通用规则引擎中的预设策略「三指标共振」，与新增的 RSI/KDJ/BOLL/ATR/平台突破等条件自由组合。

## 免责声明

本项目仅供学习研究使用，所有数据由公开免费接口（腾讯财经/Tushare）提供，不保证数据准确性与时效性。任何根据本工具结果进行的投资决策，由使用者自行承担风险。本工具不构成投资建议。

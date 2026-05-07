#!/usr/bin/env node
/**
 * 动态准备 Prisma schema：
 *   - 本地（默认）：保留 SQLite 配置，零依赖快速启动
 *   - Vercel 环境：检测到 VERCEL=1 或 POSTGRES_PRISMA_URL 时，
 *     在 build 隔离容器内把 provider 切换为 postgresql，
 *     并启用 directUrl 用于 prisma db push / migrate。
 *
 * 设计理由（KISS）：
 *   Prisma 不支持 datasource provider 由 env 变量动态切换，
 *   官方 issue: https://github.com/prisma/prisma/issues/2825
 *   因此构建期改写 schema.prisma 文本是最简单、最稳的方式。
 *   Vercel 每次部署的 build 文件系统是临时的，不会污染本地仓库。
 */
const fs = require("fs");
const path = require("path");

const SCHEMA_PATH = path.join(__dirname, "..", "prisma", "schema.prisma");

const isVercel =
  !!process.env.VERCEL ||
  /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL || "") ||
  !!process.env.POSTGRES_PRISMA_URL;

if (!isVercel) {
  console.log("[prepare-prisma] 本地环境，保留 SQLite schema");
  process.exit(0);
}

let content = fs.readFileSync(SCHEMA_PATH, "utf8");

// 已经是 postgres schema（postinstall 跑过一次了），无需重复处理
if (/provider\s*=\s*"postgresql"/.test(content)) {
  console.log("[prepare-prisma] schema 已是 PostgreSQL，跳过");
  process.exit(0);
}

const before = content;
content = content.replace(
  /datasource db \{[^}]*\}/m,
  `datasource db {
  provider  = "postgresql"
  url       = env("POSTGRES_PRISMA_URL")
  directUrl = env("POSTGRES_URL_NON_POOLING")
}`
);

if (before === content) {
  console.warn(
    "[prepare-prisma] 警告：未匹配到 datasource 块，schema 未改动。请检查 schema.prisma 格式。"
  );
  process.exit(1);
}

fs.writeFileSync(SCHEMA_PATH, content);
console.log(
  "[prepare-prisma] Vercel 部署，已切换为 PostgreSQL（POSTGRES_PRISMA_URL + directUrl）"
);

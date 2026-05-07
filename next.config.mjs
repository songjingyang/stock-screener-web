/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // 默认 1MB / 当前我们设 2MB 已不够。
      // 客户端分批扫描后 persistScanResults 已裁剪字段（每只 ~25 字节，
      // 5500 只 ≈ 140 KB），单批 runScanChunk 600 只回传约 250 KB，
      // 8 MB 兜底足够，未来加字段不必再调。
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;

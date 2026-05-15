import type { Config } from "tailwindcss";

/**
 * 现代金融浅色主题（v2）
 *
 * 设计原则：
 *   - 浅色基底 + 信任蓝主色，参考雪球 / 同花顺 Web 现代版
 *   - 涨跌色保留 A 股惯例：bull=绿（用于跌/止损以下场景）、bear=红（用于涨/止盈）
 *   - Token 名称与旧版保持一致，避免业务代码改动
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#FFFFFF",
          soft: "#F8FAFC",
          card: "#FFFFFF",
          muted: "#F1F5F9",
        },
        line: {
          DEFAULT: "#E2E8F0",
          strong: "#CBD5E1",
        },
        ink: {
          DEFAULT: "#0F172A",
          soft: "#475569",
          mute: "#94A3B8",
        },
        bull: {
          DEFAULT: "#16A34A",
          soft: "#22C55E",
        },
        bear: {
          DEFAULT: "#DC2626",
          soft: "#EF4444",
        },
        accent: {
          DEFAULT: "#2563EB",
          soft: "#3B82F6",
          mute: "#EFF6FF",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.04)",
        "card-hover": "0 2px 6px rgba(15, 23, 42, 0.06), 0 4px 12px rgba(15, 23, 42, 0.06)",
        modal: "0 8px 24px rgba(15, 23, 42, 0.1)",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};

export default config;

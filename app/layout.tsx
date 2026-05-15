import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import StockSearch from "./_components/stock-search";

export const metadata: Metadata = {
  title: "右侧交易高胜率筛选器",
  description: "基于多指标共振的 A 股右侧买点扫描与回测平台",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#FFFFFF",
};

const NAV = [
  { href: "/", label: "今日命中" },
  { href: "/morning", label: "开盘推荐" },
  { href: "/screen", label: "筛选" },
  { href: "/rotation", label: "板块" },
  { href: "/backtest", label: "回测" },
  { href: "/watchlist", label: "自选" },
  { href: "/history", label: "历史" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen flex flex-col bg-bg-soft">
        <header className="border-b border-line bg-bg/80 backdrop-blur-md sticky top-0 z-30">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 h-14 flex items-center gap-3 sm:gap-6">
            <Link
              href="/"
              className="flex items-center gap-2 font-semibold shrink-0 text-ink"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-accent ring-4 ring-accent/15" />
              <span className="hidden sm:inline">右侧交易筛选器</span>
              <span className="sm:hidden">筛选器</span>
              <span className="text-xs text-ink-mute font-normal hidden sm:inline">
                v0.1
              </span>
            </Link>
            <nav className="flex items-center gap-0.5 text-sm overflow-x-auto no-scrollbar -mx-1 px-1 flex-1 min-w-0">
              {NAV.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  className="px-3 py-1.5 rounded-lg text-ink-soft hover:text-ink hover:bg-bg-soft transition-colors whitespace-nowrap font-medium"
                >
                  {it.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto shrink-0">
              <StockSearch />
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-4 py-4 sm:py-6">
          {children}
        </main>

        <footer className="border-t border-line py-4 text-center text-xs text-ink-mute px-3 bg-bg">
          数据仅供学习研究，不构成投资建议
        </footer>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { ThemeLinks, ThemeTabs } from "@/components/layout/SiteNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "TradeSim 交易模拟器",
  description: "基于 Binance 真实行情的加密货币交易策略模拟器与实时模拟盘",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line bg-panel">
          <div className="mx-auto flex h-12 w-full max-w-[1680px] items-center gap-6 px-4">
            <Link href="/" className="text-base font-semibold tracking-tight">
              <span className="text-accent">Trade</span>Sim
              <span className="ml-2 text-xs font-normal text-muted">交易模拟器</span>
            </Link>
            <ThemeTabs />
          </div>
        </header>
        <ThemeLinks />
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}

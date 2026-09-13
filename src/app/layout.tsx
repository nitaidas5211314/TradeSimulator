import type { Metadata } from "next";
import Link from "next/link";
import { NavLinks } from "@/components/layout/NavLinks";
import "./globals.css";

export const metadata: Metadata = {
  title: "TradeSim 交易模拟器",
  description: "基于 Binance 真实历史行情的加密货币交易策略模拟器",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line bg-panel">
          <div className="mx-auto flex h-12 w-full max-w-[1680px] items-center gap-8 px-4">
            <Link href="/" className="text-base font-semibold tracking-tight">
              <span className="text-accent">Trade</span>Sim
              <span className="ml-2 text-xs font-normal text-muted">交易模拟器</span>
            </Link>
            <NavLinks />
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 两级导航：主题（模拟器 / 模拟盘）+ 主题内的页面

export interface NavLink {
  href: string;
  label: string;
}

export interface NavTheme {
  id: string;
  label: string;
  hint: string;
  links: NavLink[];
}

export const NAV_THEMES: NavTheme[] = [
  {
    id: "backtest",
    label: "模拟器",
    hint: "历史行情回测",
    links: [
      { href: "/grid", label: "网格交易" },
      { href: "/dca", label: "定投" },
      { href: "/martingale", label: "马丁格尔" },
      { href: "/arbitrage", label: "期现套利" },
      { href: "/replay", label: "K线复盘" },
      { href: "/trend", label: "趋势策略" },
      { href: "/rebalance", label: "组合再平衡" },
    ],
  },
  {
    id: "paper",
    label: "模拟盘",
    hint: "实时价格 · 多策略对比",
    links: [{ href: "/paper", label: "多策略模拟盘" }],
  },
];

function themeOf(pathname: string): NavTheme {
  return NAV_THEMES.find((t) => t.links.some((l) => pathname.startsWith(l.href))) ?? NAV_THEMES[0];
}

export function ThemeTabs() {
  const active = themeOf(usePathname());
  return (
    <nav className="flex items-center gap-1 rounded-lg border border-line bg-panel-2 p-0.5">
      {NAV_THEMES.map((theme) => (
        <Link
          key={theme.id}
          href={theme.links[0].href}
          title={theme.hint}
          className={`rounded-md px-3 py-1 text-sm transition-colors ${
            theme.id === active.id ? "bg-accent font-medium text-black" : "text-muted hover:text-fg"
          }`}
        >
          {theme.label}
        </Link>
      ))}
    </nav>
  );
}

export function ThemeLinks() {
  const pathname = usePathname();
  const active = themeOf(pathname);
  // 主题内只有一个页面时不显示第二行
  if (active.links.length < 2) return null;
  return (
    <div className="border-b border-line bg-panel/60">
      <nav className="mx-auto flex h-10 w-full max-w-[1680px] items-center gap-6 px-4 text-sm">
        {active.links.map((link) => {
          const isActive = pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex h-full items-center border-b-2 ${
                isActive ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

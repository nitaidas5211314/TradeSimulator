"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/grid", label: "网格模拟器" },
  { href: "/dca", label: "定投模拟器" },
  { href: "/martingale", label: "马丁格尔模拟器" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex h-full items-center gap-6 text-sm">
      {LINKS.map((link) => {
        const active = pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`flex h-full items-center border-b-2 ${
              active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

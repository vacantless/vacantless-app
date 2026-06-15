"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active =
    href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-1.5 font-medium transition ${
        active ? "bg-white/25" : "hover:bg-white/15"
      }`}
    >
      {children}
    </Link>
  );
}

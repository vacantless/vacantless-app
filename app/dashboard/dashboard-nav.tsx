"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS: [string, string][] = [
  ["/dashboard", "Overview"],
  ["/dashboard/properties", "Rentals"],
  ["/dashboard/leads", "Inquiries"],
  ["/dashboard/showings", "Showings"],
  ["/dashboard/availability", "Showing Times"],
  ["/dashboard/reports", "Reports"],
  ["/dashboard/billing", "Billing"],
  ["/dashboard/settings", "Settings"],
];

function isActive(pathname: string, href: string) {
  return href === "/dashboard"
    ? pathname === "/dashboard"
    : pathname.startsWith(href);
}

/**
 * Responsive dashboard nav. On md+ the links sit inline in the header bar; on
 * small screens they collapse behind a Menu toggle so the brand-colored header
 * never overflows. One `open` state, auto-closed on navigation.
 */
export function DashboardNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Desktop: inline links */}
      <div className="hidden items-center gap-1 text-sm md:flex">
        {LINKS.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className={`rounded-lg px-3 py-1.5 font-medium transition ${
              isActive(pathname, href) ? "bg-white/25" : "hover:bg-white/15"
            }`}
          >
            {label}
          </Link>
        ))}
        <form action="/auth/signout" method="post" className="ml-2">
          <button className="rounded-lg bg-white/20 px-3 py-1.5 font-medium hover:bg-white/30">
            Sign out
          </button>
        </form>
      </div>

      {/* Mobile: toggle button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Toggle navigation menu"
        className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium hover:bg-white/30 md:hidden"
      >
        {open ? "Close" : "Menu"}
      </button>

      {/* Mobile: dropdown panel (drops below the header, full width) */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 border-t border-white/20 bg-brand shadow-lg md:hidden">
          <nav className="mx-auto flex max-w-5xl flex-col gap-1 px-6 py-3 text-sm">
            {LINKS.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className={`rounded-lg px-3 py-2 font-medium transition ${
                  isActive(pathname, href) ? "bg-white/25" : "hover:bg-white/15"
                }`}
              >
                {label}
              </Link>
            ))}
            <form action="/auth/signout" method="post" className="mt-1">
              <button className="w-full rounded-lg bg-white/20 px-3 py-2 text-left font-medium hover:bg-white/30">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      )}
    </>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// ============================================================================
// Dashboard navigation — IA Step 1 (S274).
//
// Reorganized from a flat 10-item bar to a PRIMARY set of intent-areas + a
// utility/account dropdown ("More ▾"), per VACANTLESS-IA-AUDIT-2026-06-20.md.
//
//   PRIMARY:  Overview · Rentals · Leasing · Tenants · [Money — conditional]
//   MORE ▾ :  Reports · Settings · Your plan
//
// Leasing and Tenants are hub pages that tab across the existing routes
// (Inquiries/Viewings/Availability and Tenancies/People). The old routes are
// preserved, so each hub item stays highlighted while you're on a child route —
// that's what `match` (extra prefixes) is for.
//
// Money is shown only when rent collection is active for the org (Stripe
// charges_enabled OR Rotessa connected — see lib/rent-status); until then rent
// setup lives inside Tenants / the rental spine. It reuses /dashboard/rent and
// is simply labelled "Money".
// ============================================================================

type NavItem = {
  href: string;
  label: string;
  /** Extra path prefixes that should also light up this item (hub children). */
  match?: string[];
};

const PRIMARY: NavItem[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/properties", label: "Rentals" },
  {
    href: "/dashboard/leasing",
    label: "Leasing",
    match: ["/dashboard/leads", "/dashboard/showings", "/dashboard/availability"],
  },
  {
    href: "/dashboard/tenants",
    label: "Tenants",
    match: ["/dashboard/tenancies", "/dashboard/people"],
  },
];

// Conditional primary item (appended when rentActive).
const MONEY: NavItem = { href: "/dashboard/rent", label: "Money" };

// Utility / account menu (behind "More ▾" on desktop; inline on mobile).
const UTILITY: NavItem[] = [
  { href: "/dashboard/reports", label: "Reports" },
  { href: "/dashboard/settings", label: "Settings" },
  { href: "/dashboard/billing", label: "Your plan" },
];

function isActive(pathname: string, item: NavItem) {
  if (item.href === "/dashboard") return pathname === "/dashboard";
  if (pathname.startsWith(item.href)) return true;
  return (item.match ?? []).some((p) => pathname.startsWith(p));
}

/**
 * Responsive dashboard nav. On md+ the primary links sit inline with a "More ▾"
 * dropdown for utility items; on small screens everything collapses behind a
 * Menu toggle. The mobile menu lists primary + utility together.
 */
export function DashboardNav({ rentActive = false }: { rentActive?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false); // mobile menu
  const [moreOpen, setMoreOpen] = useState(false); // desktop "More ▾"
  const moreRef = useRef<HTMLDivElement>(null);

  const primary = rentActive ? [...PRIMARY, MONEY] : PRIMARY;
  const utilityActive = UTILITY.some((u) => isActive(pathname, u));

  // Close menus whenever the route changes.
  useEffect(() => {
    setOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  // Close the desktop dropdown on outside click / Escape.
  useEffect(() => {
    if (!moreOpen) return;
    function onDown(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const linkCls = (active: boolean) =>
    `rounded-lg px-3 py-1.5 font-medium transition ${
      active ? "bg-white/25" : "hover:bg-white/15"
    }`;

  return (
    <>
      {/* Desktop: inline primary links + More dropdown */}
      <div className="hidden items-center gap-1 text-sm md:flex">
        {primary.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={linkCls(isActive(pathname, item))}
          >
            {item.label}
          </Link>
        ))}

        {/* More ▾ utility dropdown */}
        <div className="relative" ref={moreRef}>
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            className={`flex items-center gap-1 ${linkCls(utilityActive && !moreOpen)}`}
          >
            More
            <span
              aria-hidden
              className={`transition ${moreOpen ? "rotate-180" : ""}`}
            >
              ▾
            </span>
          </button>
          {moreOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-30 mt-1 min-w-44 overflow-hidden rounded-lg border border-black/5 bg-white py-1 text-gray-700 shadow-lg"
            >
              {UTILITY.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  className={`block px-4 py-2 font-medium transition hover:bg-gray-100 ${
                    isActive(pathname, item) ? "text-brand" : ""
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>

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

      {/* Mobile: dropdown panel (primary + utility together) */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 border-t border-white/20 bg-brand shadow-lg md:hidden">
          <nav className="mx-auto flex max-w-5xl flex-col gap-1 px-6 py-3 text-sm">
            {primary.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-2 font-medium transition ${
                  isActive(pathname, item) ? "bg-white/25" : "hover:bg-white/15"
                }`}
              >
                {item.label}
              </Link>
            ))}
            <div className="my-1 border-t border-white/15" />
            {UTILITY.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-2 font-medium transition ${
                  isActive(pathname, item) ? "bg-white/25" : "hover:bg-white/15"
                }`}
              >
                {item.label}
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

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// ============================================================================
// Dashboard navigation - IA v2 (S427).
//
// The primary bar is now SACRED: daily landlord work only. Account/utility
// items moved out of the old "More ▾" dropdown (which mixed core work beside
// account settings) into a right-side ORG MENU keyed to the org name.
//
//   PRIMARY:  Overview · Rentals · Leasing · Tenants · Money · Maintenance
//   ORG ▾  :  Settings · Your plan · [Refer] · [Captures] · Sign out
//
// Leasing, Tenants and Money are hub landings that tab across existing routes
// (via `match` prefixes, so a hub item stays lit while you're on a child route).
//   • Leasing  → Inquiries / Viewings / Availability / Pre-screening
//   • Tenants  → Tenancies / People
//   • Money    → Rent / Expenses / Reports
//
// Money is ALWAYS visible now (S427): Expenses and Reports are useful without
// active rent collection, so the money surface never disappears - the Money hub
// itself shows a locked/empty Rent card when no rail is connected. Maintenance
// is a recurring landlord job, so it is a first-class primary tab, not a utility.
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
  {
    href: "/dashboard/money",
    label: "Money",
    match: ["/dashboard/rent", "/dashboard/expenses", "/dashboard/reports"],
  },
  { href: "/dashboard/maintenance", label: "Maintenance" },
];

// Org / account menu (behind the org pill on desktop; inline on mobile). These
// are NOT daily work - they configure or step outside the operating surface.
const ACCOUNT: NavItem[] = [
  { href: "/dashboard/settings", label: "Settings" },
  { href: "/dashboard/billing", label: "Your plan" },
];

// Referral surface (Slice 2). Ships dark: the /dashboard/referrals page is
// always reachable by URL, but this link only appears when REFERRALS_ENABLED is
// set (read in the layout, passed as the referralsEnabled prop).
const REFERRALS: NavItem = { href: "/dashboard/referrals", label: "Refer a landlord" };

// Email/text-in capture review queue (Phase 3 ingress). Ships dark like
// REFERRALS: the /dashboard/captures page is always reachable by URL (and
// server-gated on manage_settings), but this link only appears once ingress is
// live - the layout passes capturesEnabled = INBOUND_WEBHOOK_SECRET is set.
const CAPTURES: NavItem = { href: "/dashboard/captures", label: "Captures" };

function isActive(pathname: string, item: NavItem) {
  if (item.href === "/dashboard") return pathname === "/dashboard";
  if (pathname.startsWith(item.href)) return true;
  return (item.match ?? []).some((p) => pathname.startsWith(p));
}

/**
 * Responsive dashboard nav. On md+ the primary links sit inline with an ORG
 * pill ("{orgName} ▾") that opens the account menu; on small screens everything
 * collapses behind a Menu toggle listing primary + account together.
 */
export function DashboardNav({
  orgName,
  referralsEnabled = false,
  capturesEnabled = false,
}: {
  orgName: string;
  referralsEnabled?: boolean;
  capturesEnabled?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false); // mobile menu
  const [accountOpen, setAccountOpen] = useState(false); // desktop org menu
  const accountRef = useRef<HTMLDivElement>(null);

  const account = [
    ...ACCOUNT,
    ...(referralsEnabled ? [REFERRALS] : []),
    ...(capturesEnabled ? [CAPTURES] : []),
  ];
  const accountActive = account.some((u) => isActive(pathname, u));
  const initial = (orgName.trim()[0] ?? "V").toUpperCase();

  // Close menus whenever the route changes.
  useEffect(() => {
    setOpen(false);
    setAccountOpen(false);
  }, [pathname]);

  // Close the desktop org menu on outside click / Escape.
  useEffect(() => {
    if (!accountOpen) return;
    function onDown(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAccountOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);

  const linkCls = (active: boolean) =>
    `rounded-lg px-3 py-1.5 font-medium transition ${
      active ? "bg-white/25" : "hover:bg-white/15"
    }`;

  return (
    <>
      {/* Desktop: inline primary links + org account pill */}
      <div className="hidden items-center gap-1 text-sm md:flex">
        {PRIMARY.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={linkCls(isActive(pathname, item))}
          >
            {item.label}
          </Link>
        ))}

        {/* Org pill → account menu */}
        <div className="relative ml-2" ref={accountRef}>
          <button
            type="button"
            onClick={() => setAccountOpen((v) => !v)}
            aria-expanded={accountOpen}
            aria-haspopup="menu"
            className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition ${
              accountActive || accountOpen ? "bg-white/25" : "bg-white/10 hover:bg-white/20"
            }`}
          >
            <span
              aria-hidden
              className="flex h-6 w-6 items-center justify-center rounded-full bg-white/30 text-xs font-bold"
            >
              {initial}
            </span>
            <span className="max-w-[9rem] truncate font-medium">{orgName}</span>
            <span
              aria-hidden
              className={`transition ${accountOpen ? "rotate-180" : ""}`}
            >
              ▾
            </span>
          </button>
          {accountOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-30 mt-1 min-w-48 overflow-hidden rounded-lg border border-black/5 bg-white py-1 text-gray-700 shadow-lg"
            >
              {account.map((item) => (
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
              <div className="my-1 border-t border-gray-100" />
              <form action="/auth/signout" method="post">
                <button
                  role="menuitem"
                  className="block w-full px-4 py-2 text-left font-medium text-gray-700 transition hover:bg-gray-100"
                >
                  Sign out
                </button>
              </form>
            </div>
          )}
        </div>
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

      {/* Mobile: dropdown panel (primary + account together) */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 border-t border-white/20 bg-brand shadow-lg md:hidden">
          <nav className="mx-auto flex max-w-5xl flex-col gap-1 px-6 py-3 text-sm">
            {PRIMARY.map((item) => (
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
            <p className="px-3 pb-0.5 pt-1 text-xs uppercase tracking-wider text-white/60">
              {orgName}
            </p>
            {account.map((item) => (
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

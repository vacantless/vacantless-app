import Link from "next/link";
import { Icons } from "@/components/icons";

// Settings information architecture (S227, locked in
// VACANTLESS-SETTINGS-USABILITY-AUDIT-2026-06-17.md Section 8). Top tabs, sticky
// just under the Settings title. On narrow screens the strip scrolls
// horizontally (a segmented row that still reads as tabs) rather than nesting
// a second nav. The active tab is server-driven via the ?tab= param so it
// survives the redirect-based saves each section uses.
// S275 IA Step 3: "Lease Clauses" moved out to Tenants → Lease clauses (its
// point-of-use); screening + building policy moved off the brand tab too.
export type SettingsTab = "brand" | "comms" | "notifications" | "banking" | "account";

// Most tabs are sections of /dashboard/settings driven by ?tab=. "Notifications"
// is its own route (its editor is large enough to live apart and keeps the main
// settings page from growing further); `href` overrides the default ?tab= link.
const TABS: {
  key: SettingsTab;
  label: string;
  icon: keyof typeof Icons;
  href?: string;
}[] = [
  { key: "brand", label: "Public Page & Brand", icon: "page" },
  { key: "comms", label: "Communications", icon: "mail" },
  { key: "notifications", label: "Notifications", icon: "chat", href: "/dashboard/settings/notifications" },
  { key: "banking", label: "Banking & Rent", icon: "card" },
  { key: "account", label: "Account & Plan", icon: "key" },
];

export function SettingsTabs({ active }: { active: SettingsTab }) {
  return (
    <div className="sticky top-0 z-10 -mx-1 mt-4 bg-white/95 px-1 pt-1 backdrop-blur">
      <nav
        aria-label="Settings sections"
        className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-px"
      >
        {TABS.map((t) => {
          const Icon = Icons[t.icon];
          const isActive = t.key === active;
          return (
            <Link
              key={t.key}
              href={t.href ?? `/dashboard/settings?tab=${t.key}`}
              aria-current={isActive ? "page" : undefined}
              className={[
                "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-t-lg px-3.5 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "border-b-2 border-brand text-brand"
                  : "border-b-2 border-transparent text-gray-500 hover:text-gray-800",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

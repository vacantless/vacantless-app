import Link from "next/link";
import { BrandBanner, Card, IconTile } from "@/components/ui";
import { Icons } from "@/components/icons";

export const dynamic = "force-dynamic";

// ============================================================================
// Money hub (IA Step 1 follow-up, S274) — the landing for "rent coming in".
//
// /dashboard/rent previously had NO page (only the two CSV export route
// handlers under it), so the conditional "Money" nav item pointed at a 404.
// This thin hub gives it a real front door, consistent with the Leasing /
// Tenants hubs: rent is collected per tenancy, the rails are managed in
// Banking settings, and the exports live here. It does not duplicate those
// surfaces — it routes into them.
//
// Only reachable when rent collection is active (the nav hides "Money"
// otherwise — see lib/rent-status + dashboard-nav), but it's a normal page so a
// direct visit also works.
// ============================================================================

type Section = {
  href: string;
  title: string;
  desc: string;
  icon: keyof typeof Icons;
};

const SECTIONS: Section[] = [
  {
    href: "/dashboard/tenancies",
    title: "Rent collection",
    desc: "Rent is collected per tenancy. Open a tenancy to start or manage its rent schedule and see payments.",
    icon: "building",
  },
  {
    href: "/dashboard/rent/statement",
    title: "Owner statement",
    desc: "Rent collected minus maintenance spent, per property, for any period. The year-end picture for you and your accountant.",
    icon: "chart",
  },
  {
    href: "/dashboard/settings?tab=banking",
    title: "Banking & payouts",
    desc: "Connect or manage your rent rails (Stripe and Rotessa) and where payouts land.",
    icon: "card",
  },
];

export default function MoneyHubPage() {
  return (
    <div>
      <BrandBanner
        eyebrow="Money"
        title="Rent coming in"
        subtitle="Rent your tenants pay you. Set it up inside each tenancy, manage your rails in Banking, and export your records here."
        icon={<Icons.card className="h-6 w-6" />}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((s) => {
          const Icon = Icons[s.icon];
          return (
            <Link key={s.href} href={s.href} className="block">
              <Card hover className="h-full">
                <div className="flex items-start gap-3.5">
                  <IconTile>
                    <Icon className="h-5 w-5" />
                  </IconTile>
                  <div className="min-w-0">
                    <h2 className="font-semibold text-gray-900">{s.title}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-gray-600">
                      {s.desc}
                    </p>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Exports — the two existing CSV download routes, given a home. Each
          self-handles the not-connected case (bounces to Banking settings). */}
      <Card className="mt-4 bg-gray-50">
        <div className="flex items-start gap-3.5">
          <IconTile>
            <Icons.chart className="h-5 w-5" />
          </IconTile>
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">Export your records</h2>
            <p className="mt-1 text-sm leading-relaxed text-gray-600">
              Download a CSV of rent activity for your records or year-end taxes.
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Leave dates blank for everything.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <a
                href="/dashboard/rent/statement/export"
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
              >
                Owner statement CSV
              </a>
              <form action="/dashboard/rent/export" method="get" className="flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">From</span>
                  <input type="date" name="from" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">To</span>
                  <input type="date" name="to" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
                </label>
                <button
                  type="submit"
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
                >
                  Rotessa rent CSV
                </button>
              </form>
              <form action="/dashboard/rent/stripe-export" method="get" className="flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">From</span>
                  <input type="date" name="from" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">To</span>
                  <input type="date" name="to" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
                </label>
                <button
                  type="submit"
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
                >
                  Stripe payouts CSV
                </button>
              </form>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { BrandBanner, Card, IconTile } from "@/components/ui";
import { Icons } from "@/components/icons";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { hasEntitlement } from "@/lib/billing";
import { isRentCollectionActive } from "@/lib/rent-status";

export const dynamic = "force-dynamic";

// ============================================================================
// Money hub (IA v2, S427) - the cross-unit "front door" for the money side of
// the operation: collecting rent, tracking what you spend, and seeing where the
// portfolio stands. A thin landing that routes into the existing pages
// (Rent / Expenses / Owner statement); it does NOT duplicate their content.
// The leasing FUNNEL report (/dashboard/reports) is not money - it lives under
// the Leasing hub, not here.
//
// Money is ALWAYS in the primary nav now - Expenses and Reports are useful with
// or without active rent collection. When no rent rail is connected, the Rent
// card shows a "set it up" state instead of vanishing, so the section never
// feels like the product forgot it.
// ============================================================================

type Section = {
  href: string;
  title: string;
  desc: string;
  icon: keyof typeof Icons;
};

const SECTIONS: Section[] = [
  {
    href: "/dashboard/money/reconcile",
    title: "Reconcile",
    desc: "Match bank transactions to rent, expenses, or exclusions, and keep the accounting queue clean.",
    icon: "check",
  },
  {
    href: "/dashboard/money/import-history",
    title: "Import history",
    desc: "Upload categorized FreshBooks history, preview the matches, and seed accounting rules before committing anything.",
    icon: "page",
  },
  {
    href: "/dashboard/expenses",
    title: "Expenses",
    desc: "Log and categorize what each rental costs - import a bank feed, sort the money out, and keep every expense against the right unit.",
    icon: "list",
  },
  {
    href: "/dashboard/rent/statement",
    title: "Owner statement",
    desc: "Your owner statement and rent roll - money in, money out, and net across the portfolio, ready to share or export.",
    icon: "chart",
  },
];

export default async function MoneyHubPage() {
  const supabase = createClient();
  const org = await getCurrentOrg();
  const accounting = hasEntitlement(org?.plan, "accounting");
  // RLS scopes both reads to the current org; we select only the status fields
  // needed to decide whether a rent rail is connected.
  const [{ data: stripeRows }, { data: rotessaRows }] = await Promise.all([
    supabase.from("stripe_connect_accounts").select("charges_enabled").limit(1),
    supabase.from("rotessa_accounts").select("connection_status").limit(1),
  ]);
  const rentActive = isRentCollectionActive({
    stripeChargesEnabled: (stripeRows?.[0] as { charges_enabled?: boolean } | undefined)
      ?.charges_enabled ?? null,
    rotessaConnectionStatus: (rotessaRows?.[0] as { connection_status?: string } | undefined)
      ?.connection_status ?? null,
  });

  return (
    <div>
      <BrandBanner
        eyebrow="Money"
        title="Rent, expenses, and the bottom line"
        subtitle="Collect the rent, track what each unit costs, and see how the portfolio is doing - all in one place. Open any rental to work a single unit end-to-end."
        icon={<Icons.card className="h-6 w-6" />}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {/* Rent - always shown; a not-yet-connected rail gets a set-it-up state
            rather than disappearing. */}
        <Link href="/dashboard/rent" className="block">
          <Card hover className="h-full">
            <div className="flex items-start gap-3.5">
              <IconTile>
                <Icons.card className="h-5 w-5" />
              </IconTile>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-gray-900">Rent</h2>
                  {!rentActive && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                      Not set up yet
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-gray-600">
                  {rentActive
                    ? "Scheduled rent, who has paid, and what is outstanding across your tenancies."
                    : "Set up rent collection to schedule rent, track who has paid, and see what is outstanding. You can still record payments by hand until then."}
                </p>
              </div>
            </div>
          </Card>
        </Link>

        {SECTIONS.map((s) => {
          const Icon = Icons[s.icon];
          const locked = s.href === "/dashboard/money/reconcile" && !accounting;
          return (
            <Link key={s.href} href={s.href} className="block">
              <Card hover className="h-full">
                <div className="flex items-start gap-3.5">
                  <IconTile>
                    <Icon className="h-5 w-5" />
                  </IconTile>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-gray-900">{s.title}</h2>
                      {locked && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-100">
                          Premium
                        </span>
                      )}
                    </div>
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
    </div>
  );
}

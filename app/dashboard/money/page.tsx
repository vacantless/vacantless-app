import Link from "next/link";
import { PageHeader, Card, IconTile } from "@/components/ui";
import { Icons } from "@/components/icons";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { redirect } from "next/navigation";
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
    href: "/dashboard/money/income-statement",
    title: "Income statement (P&L)",
    desc: "Revenue minus operating expenses is your NOI; less interest is net income - the monthly profit picture.",
    icon: "chart",
  },
  {
    href: "/dashboard/money/spend",
    title: "Spend",
    desc: "Category share, monthly trend, and recurring charges from the expense ledger you already keep.",
    icon: "chart",
  },
  {
    href: "/dashboard/money/tax-package",
    title: "Tax package (T776)",
    desc: "Your year of rent and expenses mapped to the T776 tax lines, ready for your accountant.",
    icon: "chart",
  },
  {
    href: "/dashboard/money/accountant-package",
    title: "Accountant package",
    desc: "The whole year - ledger, T776, statements, and QuickBooks/Xero import files - as one zip to hand to whoever does the taxes.",
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

// S759: Premium is not on sale (hidden on /dashboard/billing since S702j), so
// its accounting cards were doors into a "See plans" page with no way to buy
// it. Accounts without the accounting entitlement no longer see them; an org
// already on Premium sees them as before.
const ACCOUNTING_HREFS = new Set([
  "/dashboard/money/reconcile",
  "/dashboard/money/import-history",
  "/dashboard/money/income-statement",
  "/dashboard/money/spend",
  "/dashboard/money/tax-package",
  "/dashboard/money/accountant-package",
]);

export default async function MoneyHubPage() {
  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const accounting = hasEntitlement(org.plan, "accounting");
  // Select only the current org's status fields needed to decide whether a rent
  // rail is connected.
  const [{ data: stripeRows }, { data: rotessaRows }] = await Promise.all([
    supabase
      .from("stripe_connect_accounts")
      .select("charges_enabled")
      .eq("organization_id", org.id)
      .limit(1),
    supabase
      .from("rotessa_accounts")
      .select("connection_status")
      .eq("organization_id", org.id)
      .limit(1),
  ]);
  const rentActive = isRentCollectionActive({
    stripeChargesEnabled: (stripeRows?.[0] as { charges_enabled?: boolean } | undefined)
      ?.charges_enabled ?? null,
    rotessaConnectionStatus: (rotessaRows?.[0] as { connection_status?: string } | undefined)
      ?.connection_status ?? null,
  });

  return (
    <div>
      <PageHeader
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

        {SECTIONS.filter((s) => accounting || !ACCOUNTING_HREFS.has(s.href)).map((s) => {
          const Icon = Icons[s.icon];
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

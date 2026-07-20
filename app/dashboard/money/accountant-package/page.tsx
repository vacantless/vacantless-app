import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { planEntitlements } from "@/lib/billing";
import {
  BrandBanner,
  Card,
  EmptyState,
  SectionHeading,
  SECONDARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";

export const dynamic = "force-dynamic";

// S532 accountant hand-off package (Premium accounting). One page, one
// download: the whole year — general ledger, T776, P&L, owner statement, rent
// roll, and QuickBooks/Xero import files — as a single zip to hand to whoever
// does the taxes. The heavy lifting lives in the export route + pure builders;
// this page only picks the year and explains what's in the pack.

type DatedRow = { paid_on?: string | null; completed_on?: string | null; incurred_on?: string | null };

function yearFromDate(date: string | null | undefined): number | null {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec((date ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isInteger(year) && year >= 1900 && year <= 9999 ? year : null;
}

function parseYearParam(raw: string | undefined): number | null {
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= 1900 && year <= 9999 ? year : null;
}

function pageHref(year: number): string {
  return `/dashboard/money/accountant-package?year=${year}`;
}

function exportHref(year: number): string {
  return `/dashboard/money/accountant-package/export?year=${year}`;
}

const PACKAGE_CONTENTS: { file: string; desc: string }[] = [
  {
    file: "general-ledger.csv",
    desc: "Every transaction in the year - rent received, expenses, and completed work-order costs - each with its category and T776 line.",
  },
  {
    file: "t776-tax-package.csv",
    desc: "The year mapped to T776 rental tax lines, per property and for the portfolio.",
  },
  {
    file: "income-statement.csv",
    desc: "Actual-basis P&L: revenue, operating expenses, NOI, interest, and net income.",
  },
  {
    file: "owner-statement.csv",
    desc: "The cash summary per property, with month-by-month detail.",
  },
  {
    file: "rent-roll.csv",
    desc: "Current tenancies, rents, and occupancy across the portfolio.",
  },
  {
    file: "quickbooks-transactions.csv",
    desc: "The ledger in QuickBooks Online's 3-column bank format, ready for Banking → Upload transactions.",
  },
  {
    file: "xero-transactions.csv",
    desc: "The ledger in Xero's bank-statement format, ready for Import a statement.",
  },
  {
    file: "README.txt",
    desc: "How the numbers are kept: cash-basis rent, actual-basis costs, principal as memo, CCA left for your accountant.",
  },
];

export default async function AccountantPackagePage({
  searchParams,
}: {
  searchParams: { year?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  if (!planEntitlements(org.plan).accounting) {
    return (
      <div className="mx-auto max-w-3xl">
        <BrandBanner
          eyebrow="Money"
          title="Accountant package"
          subtitle="Your whole year - ledger, tax lines, statements, and import files - in one download for whoever does the taxes."
          icon={<Icons.page className="h-6 w-6" />}
        />
        <EmptyState
          icon={<Icons.page className="h-5 w-5" />}
          title="Accountant package is a Premium feature"
          description="Premium bundles the general ledger, T776 tax package, income statement, owner statement, rent roll, and QuickBooks/Xero import files into a single zip your accountant can work from directly."
          cta={{ href: "/dashboard/billing", label: "See plans" }}
        />
      </div>
    );
  }

  // Only the date columns — enough to offer the years that actually have
  // activity. RLS scopes every read to the current org.
  const supabase = createClient();
  const [{ data: rentData }, { data: woData }, { data: expData }] = await Promise.all([
    supabase.from("rent_payments").select("paid_on"),
    supabase.from("work_orders").select("completed_on"),
    supabase.from("expenses").select("incurred_on"),
  ]);

  const currentYear = new Date().getFullYear();
  const years = new Set<number>([currentYear]);
  for (const row of [
    ...((rentData ?? []) as DatedRow[]),
    ...((woData ?? []) as DatedRow[]),
    ...((expData ?? []) as DatedRow[]),
  ]) {
    const year = yearFromDate(row.paid_on ?? row.completed_on ?? row.incurred_on);
    if (year) years.add(year);
  }
  const sortedYears = [...years].sort((a, b) => b - a);
  const requestedYear = parseYearParam(searchParams.year);
  // Default to the most recent COMPLETE year when one has activity — that is
  // the year an accountant is actually filing.
  const year =
    requestedYear ?? sortedYears.find((y) => y !== currentYear) ?? currentYear;

  return (
    <div className="mx-auto max-w-3xl">
      <BrandBanner
        eyebrow={`Money · ${org.name}`}
        title={`Accountant package (${year})`}
        subtitle="Your whole year - ledger, tax lines, statements, and import files - in one download for whoever does the taxes."
        icon={<Icons.page className="h-6 w-6" />}
        action={
          <a href={exportHref(year)} className={SECONDARY_ACTION_CLASS}>
            Download zip
          </a>
        }
      />

      <div className="mb-5 mt-6 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm font-medium text-gray-600">Tax year</span>
        {sortedYears.map((y) => (
          <Link
            key={y}
            href={pageHref(y)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              y === year
                ? "bg-brand text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {y}
          </Link>
        ))}
      </div>

      <div className="mt-6">
        <SectionHeading>What&apos;s in the {year} package</SectionHeading>
        <Card padded={false}>
          <ul className="divide-y divide-gray-50">
            {PACKAGE_CONTENTS.map((item) => (
              <li key={item.file} className="flex items-start gap-3 px-4 py-3">
                <Icons.page className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <div className="min-w-0">
                  <div className="font-mono text-sm text-gray-900">{item.file}</div>
                  <p className="mt-0.5 text-sm leading-relaxed text-gray-600">{item.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-gray-500">
        The package summarizes your records in Vacantless - it is not a filed return, and
        Vacantless never moves money. CCA (line 9936) is left blank on purpose: it is a claim
        decision to make with your accountant. See the full figures on the{" "}
        <Link href={`/dashboard/money/tax-package?year=${year}`} className="font-medium text-brand underline">
          tax package
        </Link>{" "}
        and{" "}
        <Link href="/dashboard/money/income-statement" className="font-medium text-brand underline">
          income statement
        </Link>
        .
      </p>
    </div>
  );
}

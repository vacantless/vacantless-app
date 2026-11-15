import Link from "next/link";
import { redirect } from "next/navigation";
import { Icons } from "@/components/icons";
import { PageHeader, SECONDARY_ACTION_CLASS } from "@/components/ui";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { BulkImportForm } from "./bulk-import-form";

export const dynamic = "force-dynamic";

// S799d (REVIEW-S799 item 1): add several rentals at once. Plans cover up to
// 75 rentals, and until now each one was typed by hand.

function n(v: string | string[] | undefined): number {
  const x = Number.parseInt(String(Array.isArray(v) ? v[0] : (v ?? "")), 10);
  return Number.isFinite(x) && x > 0 ? x : 0;
}

export default async function ImportRentalsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();
  const { data } = await supabase
    .from("properties")
    .select("address")
    .eq("organization_id", org.id)
    .is("archived_at", null);
  const existingAddresses = ((data ?? []) as { address: string | null }[])
    .map((p) => p.address ?? "")
    .filter(Boolean);

  const saved = n(searchParams.saved);
  const tenancies = n(searchParams.tenancies);
  const skipped = n(searchParams.skipped);
  const over = n(searchParams.over);
  const failed = n(searchParams.failed);
  const err = String(searchParams.err ?? "");
  const errLine =
    err === "empty"
      ? "Paste your rows first."
      : err === "none"
        ? "None of those rows could be saved. Check the notes on each row."
        : err === "full"
          ? "Your account is at its rental limit, so none were saved."
          : err === "forbidden"
            ? "You cannot add tenants on this sign in. Ask the account owner."
            : "";

  return (
    <div>
      <PageHeader
        eyebrow="Rentals"
        title="Add several rentals"
        subtitle="Paste them from your spreadsheet. Check the list, then save once."
        icon={<Icons.building />}
        action={
          <Link href="/dashboard/properties" className={SECONDARY_ACTION_CLASS}>
            Back to rentals
          </Link>
        }
      />

      {saved > 0 && (
        <div className="mb-5 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-semibold">
            {saved === 1 ? "1 rental saved." : `${saved} rentals saved.`}
            {tenancies > 0 ? ` ${tenancies === 1 ? "1 tenant" : `${tenancies} tenants`} added.` : ""}
          </p>
          {skipped > 0 && <p className="mt-1">{skipped} left out. Paste those rows again to see why.</p>}
          {failed > 0 && <p className="mt-1">{failed} could not be saved. Try those rows again.</p>}
          <p className="mt-2">
            <Link href="/dashboard/properties" className="font-semibold underline">
              See your rentals
            </Link>
          </p>
        </div>
      )}
      {over > 0 && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {over === 1 ? "1 rental is" : `${over} rentals are`} over your rental limit.{" "}
          <Link href="/dashboard/billing#plans" className="font-semibold underline">
            See Billing
          </Link>
        </div>
      )}
      {errLine && (
        <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{errLine}</div>
      )}

      <BulkImportForm existingAddresses={existingAddresses} />
    </div>
  );
}

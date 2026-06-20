import Link from "next/link";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { ClauseLibrary, type ClauseView } from "@/components/clause-library";
import {
  clauseErrorMessage,
  type ClauseApplicability,
  type RiskLevel,
  type Jurisdiction,
} from "@/lib/clauses";
import { BrandBanner } from "@/components/ui";
import { Icons } from "@/components/icons";

export const dynamic = "force-dynamic";

// ============================================================================
// Lease clause library — IA Step 3 (S275). Relocated out of its own top-level
// Settings tab to its point-of-use: Tenants (where leases are prepared and the
// clauses are actually used — "set where you use them", the G7 fix). The editor
// moved whole; the clause CRUD actions (clause-actions.ts) now redirect back
// here. Settings keeps a one-line bridge. Nav highlights "Tenants" (path under
// /dashboard/tenants).
// ============================================================================

const CLAUSE_SUCCESS: Record<string, string> = {
  created: "Clause added.",
  updated: "Clause details saved.",
  version_added: "New version saved and made current.",
  version_current: "Current version updated.",
  deleted: "Clause deleted.",
};

export default async function LeaseClausesPage({
  searchParams,
}: {
  searchParams: { clause?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) return null;

  const supabase = createClient();

  // Lease clause library (#11 slice 2). Fetch clauses + their versions, then
  // shape into ClauseView[] (versions newest-first). RLS scopes both to this org.
  const { data: clauseRows } = await supabase
    .from("lease_clauses")
    .select("id, key, title, category, applicable_to, risk_level, jurisdiction, notes_for_landlord")
    .order("category", { ascending: true })
    .order("key", { ascending: true });
  const clauseList = (clauseRows ?? []) as {
    id: string;
    key: string;
    title: string;
    category: string;
    applicable_to: ClauseApplicability;
    risk_level: RiskLevel;
    jurisdiction: Jurisdiction;
    notes_for_landlord: string | null;
  }[];
  const { data: versionRows } = await supabase
    .from("lease_clause_versions")
    .select("id, clause_id, version, is_current, body, note")
    .order("version", { ascending: false });
  const versionList = (versionRows ?? []) as {
    id: string;
    clause_id: string;
    version: number;
    is_current: boolean;
    body: string;
    note: string | null;
  }[];
  const clauseViews: ClauseView[] = clauseList.map((c) => ({
    id: c.id,
    key: c.key,
    title: c.title,
    category: c.category,
    risk_level: c.risk_level ?? "standard",
    jurisdiction: c.jurisdiction ?? "ontario",
    applicable_to: c.applicable_to,
    notes_for_landlord: c.notes_for_landlord ?? null,
    versions: versionList
      .filter((v) => v.clause_id === c.id)
      .map((v) => ({
        id: v.id,
        version: v.version,
        is_current: v.is_current,
        body: v.body,
        note: v.note,
      })),
  }));

  const clauseFlash = searchParams.clause
    ? (CLAUSE_SUCCESS[searchParams.clause] ?? null)
    : null;
  const clauseError =
    searchParams.clause && !CLAUSE_SUCCESS[searchParams.clause]
      ? searchParams.clause === "forbidden"
        ? "You don't have permission to manage lease clauses."
        : searchParams.clause === "key_taken"
          ? "A clause with that key already exists. Pick a different key."
          : searchParams.clause === "error"
            ? "Something went wrong. Please try again."
            : (clauseErrorMessage(searchParams.clause) ??
              "Something went wrong. Please try again.")
      : null;

  return (
    <div>
      <BrandBanner
        eyebrow="Tenants"
        title="Lease clauses"
        subtitle="Your reusable clause library. Build it here once; pull clauses in when you prepare a lease inside a tenancy."
        icon={<Icons.list className="h-6 w-6" />}
      />

      <p className="mt-4 text-sm text-gray-500">
        <Link href="/dashboard/tenancies" className="font-medium text-brand underline">
          ← Back to Tenancies
        </Link>
      </p>

      <div className="mt-6 space-y-6">
        {clauseFlash && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            {clauseFlash}
          </div>
        )}
        {clauseError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {clauseError}
          </div>
        )}
        <ClauseLibrary clauses={clauseViews} />
      </div>
    </div>
  );
}

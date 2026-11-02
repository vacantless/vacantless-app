import type { SupabaseClient } from "@supabase/supabase-js";
import type { StandardLeaseDetails, StandardLeaseInput } from "@/lib/standard-lease";
import { carryForwardDetails } from "@/lib/standard-lease";

// S743: load one lease's Standard Form input. RLS scopes every read to the
// caller's org; the tenancy_id check ties the lease to the tenancy in the URL.

export type StandardLeaseLoaded = {
  input: StandardLeaseInput;
  additionalTerms: string | null;
  status: string;
  title: string;
  /** True when these details came from this landlord's last lease, not this one. */
  carried: boolean;
};

export async function loadStandardLease(
  supabase: SupabaseClient,
  args: { tenancyId: string; leaseId: string; orgId: string; orgName: string },
): Promise<StandardLeaseLoaded | null> {
  const { data: leaseRow } = await supabase
    .from("lease_documents")
    .select("id, title, status, assembled_body, standard_form")
    .eq("id", args.leaseId)
    .eq("tenancy_id", args.tenancyId)
    .maybeSingle();
  if (!leaseRow) return null;
  const lease = leaseRow as { title: string; status: string; assembled_body: string | null; standard_form: StandardLeaseDetails | null };

  const { data: tRow } = await supabase
    .from("tenancies")
    .select("rent_cents, deposit_cents, start_date, end_date, term_months, property:properties(address), tenants(name, is_primary)")
    .eq("id", args.tenancyId)
    .maybeSingle();
  if (!tRow) return null;
  const t = tRow as unknown as {
    rent_cents: number | null; deposit_cents: number | null; start_date: string | null; end_date: string | null;
    term_months: number | null; property: { address: string } | { address: string }[] | null;
    tenants: { name: string | null; is_primary: boolean }[];
  };
  const prop = Array.isArray(t.property) ? t.property[0] : t.property;
  const tenantNames = (t.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((x) => (x.name ?? "").trim())
    .filter(Boolean);

  let details = lease.standard_form ?? {};
  let carried = false;
  if (Object.keys(details).length === 0) {
    // First visit: start from this landlord's most recent filled lease.
    const { data: prev } = await supabase
      .from("lease_documents")
      .select("standard_form")
      .eq("organization_id", args.orgId)
      .neq("id", args.leaseId)
      .neq("standard_form", "{}")
      .order("updated_at", { ascending: false })
      .limit(1);
    const p = ((prev ?? []) as { standard_form: StandardLeaseDetails | null }[])[0]?.standard_form;
    if (p && Object.keys(p).length) { details = carryForwardDetails(p); carried = true; }
  }

  return {
    input: {
      landlordName: args.orgName,
      tenantNames,
      propertyAddress: prop?.address ?? null,
      startDate: t.start_date,
      endDate: t.end_date,
      termMonths: t.term_months,
      rentCents: t.rent_cents,
      depositCents: t.deposit_cents,
      hasAdditionalTerms: Boolean((lease.assembled_body ?? "").trim()),
      details,
    },
    additionalTerms: lease.assembled_body,
    status: lease.status,
    title: lease.title,
    carried,
  };
}

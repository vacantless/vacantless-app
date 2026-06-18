import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { personDisplayName, sortPeople, type PersonSummary } from "@/lib/persons";
import { EmptyState, BrandBanner } from "@/components/ui";
import { Icons } from "@/components/icons";

export const dynamic = "force-dynamic";

type PersonRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};
type TenantRow = { person_id: string | null; tenancy_id: string };
type DocRow = { id: string; tenancy_id: string | null };
type SignerRow = { person_id: string | null; lease_document_id: string };

// The per-person vault index. A "person" is the durable, cross-tenancy identity
// (migration 0042) that a tenant/signer maps onto — so this is the one place a
// landlord can see everyone they've ever rented to, regardless of which unit or
// when, and jump to that person's whole document history.
export default async function PeoplePage() {
  const supabase = createClient();

  // RLS scopes every query to the operator's org. Counts are computed in-memory
  // from these org-scoped sets (small) to avoid an N+1 per person.
  const [{ data: personRows }, { data: tenantRows }, { data: docRows }, { data: signerRows }] =
    await Promise.all([
      supabase.from("persons").select("id, full_name, email, phone"),
      supabase.from("tenants").select("person_id, tenancy_id"),
      supabase.from("lease_documents").select("id, tenancy_id"),
      supabase.from("lease_signers").select("person_id, lease_document_id"),
    ]);

  const persons = (personRows ?? []) as PersonRow[];
  const tenants = (tenantRows ?? []) as TenantRow[];
  const docs = (docRows ?? []) as DocRow[];
  const signers = (signerRows ?? []) as SignerRow[];

  // tenancy_id -> the document ids on it (for the tenancy reach path).
  const docsByTenancy = new Map<string, string[]>();
  for (const d of docs) {
    if (!d.tenancy_id) continue;
    const arr = docsByTenancy.get(d.tenancy_id) ?? [];
    arr.push(d.id);
    docsByTenancy.set(d.tenancy_id, arr);
  }
  // person_id -> the document ids they personally signed.
  const signedByPerson = new Map<string, string[]>();
  for (const s of signers) {
    if (!s.person_id) continue;
    const arr = signedByPerson.get(s.person_id) ?? [];
    arr.push(s.lease_document_id);
    signedByPerson.set(s.person_id, arr);
  }
  // person_id -> their tenancy ids.
  const tenanciesByPerson = new Map<string, Set<string>>();
  for (const t of tenants) {
    if (!t.person_id) continue;
    const set = tenanciesByPerson.get(t.person_id) ?? new Set<string>();
    set.add(t.tenancy_id);
    tenanciesByPerson.set(t.person_id, set);
  }

  const summaries: PersonSummary[] = persons.map((p) => {
    const tenancyIds = tenanciesByPerson.get(p.id) ?? new Set<string>();
    const docIds = new Set<string>();
    for (const tid of tenancyIds) {
      for (const did of docsByTenancy.get(tid) ?? []) docIds.add(did);
    }
    for (const did of signedByPerson.get(p.id) ?? []) docIds.add(did);
    return {
      id: p.id,
      display_name: personDisplayName(p),
      email: p.email,
      phone: p.phone,
      tenancy_count: tenancyIds.size,
      document_count: docIds.size,
    };
  });
  const rows = sortPeople(summaries);

  return (
    <div>
      <BrandBanner
        icon={<Icons.users />}
        eyebrow="Property management"
        title="People"
        subtitle="Everyone you've rented to, as a permanent record that follows the person across units and tenancies. Open anyone to see every lease and document tied to them — even from a tenancy that has ended."
      />

      {rows.length > 0 ? (
        <>
          <p className="mb-3 text-sm text-gray-500">
            {rows.length} {rows.length === 1 ? "person" : "people"}
          </p>
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            {rows.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/dashboard/people/${p.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 hover:bg-gray-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-gray-900">{p.display_name}</span>
                    <span className="block truncate text-xs text-gray-500">
                      {p.email ?? p.phone ?? "No contact on file"}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm text-gray-500">
                    {p.tenancy_count} {p.tenancy_count === 1 ? "tenancy" : "tenancies"} ·{" "}
                    {p.document_count} {p.document_count === 1 ? "document" : "documents"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState
          icon={<Icons.users />}
          title="No people yet"
          description="People appear here automatically as you add tenants to a tenancy. Each person becomes a permanent record that carries their leases and documents across every unit they rent from you."
          cta={{ href: "/dashboard/tenancies", label: "Go to tenancies" }}
        />
      )}
    </div>
  );
}

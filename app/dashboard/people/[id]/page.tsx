import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  personDisplayName,
  mergePersonDocuments,
  sortVaultTenancies,
  type VaultDocument,
  type VaultTenancy,
} from "@/lib/persons";
import { tenancyStatusLabel } from "@/lib/tenancy";
import { StatusChip, tenancyStatusTone, SectionHeading, type ChipTone } from "@/components/ui";
import { Icons } from "@/components/icons";

export const dynamic = "force-dynamic";

type DocBase = Omit<VaultDocument, "signed_by_person">;

/** Lease document status -> chip tone. */
function leaseStatusTone(status: string): ChipTone {
  switch (status) {
    case "executed":
      return "success";
    case "sent":
      return "info";
    case "void":
      return "danger";
    default:
      return "neutral";
  }
}

function leaseStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

export default async function PersonVaultPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  // RLS scopes to the operator's org — an out-of-org / unknown id 404s.
  const { data: personRow } = await supabase
    .from("persons")
    .select("id, full_name, email, phone, notes, created_at")
    .eq("id", params.id)
    .maybeSingle();
  if (!personRow) notFound();
  const person = personRow as {
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
    created_at: string;
  };

  // The person's tenancies (across units) + the documents reached via them, and
  // the documents this person personally signed (the two vault paths).
  const { data: tenantRows } = await supabase
    .from("tenants")
    .select(
      "is_primary, tenancy:tenancies(id, status, start_date, end_date, property:properties(address))",
    )
    .eq("person_id", person.id);

  type TenantJoin = {
    is_primary: boolean;
    tenancy: {
      id: string;
      status: string;
      start_date: string | null;
      end_date: string | null;
      property: { address: string } | null;
    } | null;
  };
  const tenantJoins = (tenantRows ?? []) as unknown as TenantJoin[];
  const tenancies: VaultTenancy[] = sortVaultTenancies(
    tenantJoins
      .filter((r) => r.tenancy)
      .map((r) => ({
        id: r.tenancy!.id,
        property_address: r.tenancy!.property?.address ?? null,
        status: r.tenancy!.status,
        start_date: r.tenancy!.start_date,
        end_date: r.tenancy!.end_date,
        is_primary: r.is_primary,
      })),
  );
  const tenancyIds = tenancies.map((t) => t.id);

  // Documents via the person's tenancies.
  let viaTenancy: DocBase[] = [];
  if (tenancyIds.length > 0) {
    const { data: docRows } = await supabase
      .from("lease_documents")
      .select("id, tenancy_id, title, status, created_at, executed_at")
      .in("tenancy_id", tenancyIds);
    viaTenancy = (docRows ?? []) as DocBase[];
  }

  // Documents this person signed (or is assigned to sign) + the signature record.
  const { data: signerRows } = await supabase
    .from("lease_signers")
    .select(
      "id, role, status, signed_at, signature_kind, lease_document:lease_documents(id, tenancy_id, title, status, created_at, executed_at)",
    )
    .eq("person_id", person.id);
  type SignerJoin = {
    status: string;
    signed_at: string | null;
    lease_document: DocBase | null;
  };
  const signerJoins = (signerRows ?? []) as unknown as SignerJoin[];
  const viaSigner: DocBase[] = signerJoins
    .filter((r) => r.lease_document)
    .map((r) => r.lease_document as DocBase);
  // Which documents this person has actually SIGNED (status 'signed').
  const signedDocIds = signerJoins
    .filter((r) => r.status === "signed" && r.lease_document)
    .map((r) => (r.lease_document as DocBase).id);
  // Signed-at per document, for the audit line.
  const signedAtByDoc = new Map<string, string | null>();
  for (const r of signerJoins) {
    if (r.status === "signed" && r.lease_document) {
      signedAtByDoc.set(r.lease_document.id, r.signed_at);
    }
  }

  const documents = mergePersonDocuments(viaTenancy, viaSigner, signedDocIds);

  return (
    <div>
      <div className="mb-4">
        <Link href="/dashboard/people" className="text-sm text-gray-500 hover:text-gray-700">
          ← All people
        </Link>
      </div>

      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-gray-400">
            <Icons.users />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-gray-900">
              {personDisplayName(person)}
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {[person.email, person.phone].filter(Boolean).join(" · ") || "No contact on file"}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              {tenancies.length} {tenancies.length === 1 ? "tenancy" : "tenancies"} ·{" "}
              {documents.length} {documents.length === 1 ? "document" : "documents"} · in your
              records since {fmtDate(person.created_at)}
            </p>
          </div>
        </div>
        {person.notes && <p className="mt-3 text-sm text-gray-600">{person.notes}</p>}
      </div>

      {/* Tenancies across units --------------------------------------------- */}
      <SectionHeading>Tenancies</SectionHeading>
      {tenancies.length > 0 ? (
        <ul className="mb-8 divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {tenancies.map((t) => (
            <li key={t.id}>
              <Link
                href={`/dashboard/tenancies/${t.id}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 hover:bg-gray-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-gray-900">
                    {t.property_address ?? "Unit removed"}
                  </span>
                  <span className="block truncate text-xs text-gray-500">
                    {t.start_date ? `from ${t.start_date}` : "no start date"}
                    {t.end_date ? ` to ${t.end_date}` : ""}
                    {t.is_primary ? " · primary tenant" : " · co-tenant"}
                  </span>
                </span>
                <StatusChip tone={tenancyStatusTone(t.status)}>
                  {tenancyStatusLabel(t.status)}
                </StatusChip>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-8 rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
          No tenancies linked to this person.
        </p>
      )}

      {/* Documents that follow the person ----------------------------------- */}
      <SectionHeading>Documents</SectionHeading>
      {documents.length > 0 ? (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {documents.map((d) => {
            const signedAt = signedAtByDoc.get(d.id);
            return (
              <li key={d.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-gray-900">{d.title}</span>
                      {d.signed_by_person && (
                        <StatusChip tone="brand">Signed</StatusChip>
                      )}
                    </span>
                    <span className="block truncate text-xs text-gray-500">
                      Created {fmtDate(d.created_at)}
                      {d.executed_at ? ` · executed ${fmtDate(d.executed_at)}` : ""}
                      {signedAt ? ` · signed ${fmtDate(signedAt)}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <StatusChip tone={leaseStatusTone(d.status)}>
                      {leaseStatusLabel(d.status)}
                    </StatusChip>
                    {d.tenancy_id && (
                      <Link
                        href={`/dashboard/tenancies/${d.tenancy_id}/lease/${d.id}`}
                        className="text-sm text-gray-600 underline hover:text-gray-900"
                      >
                        View
                      </Link>
                    )}
                    {d.tenancy_id && d.status === "executed" && (
                      <Link
                        href={`/dashboard/tenancies/${d.tenancy_id}/lease/${d.id}/certificate`}
                        className="text-sm text-gray-600 underline hover:text-gray-900"
                      >
                        Certificate
                      </Link>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
          No documents on file for this person yet.
        </p>
      )}
    </div>
  );
}

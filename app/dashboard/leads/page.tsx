import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  PIPELINE_STAGES,
  statusLabel,
  isLeadStatus,
  type LeadStatus,
} from "@/lib/pipeline";
import { EmptyState } from "@/components/ui";
import { StatusSelect } from "./status-select";

export const dynamic = "force-dynamic";

type LeadRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: LeadStatus;
  created_at: string;
  property: { address: string } | null;
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const supabase = createClient();
  const { data } = await supabase
    .from("leads")
    .select(
      "id, name, email, phone, source, status, created_at, property:properties(address)",
    )
    .order("created_at", { ascending: false });

  const all = (data ?? []) as unknown as LeadRow[];
  const filter =
    searchParams.status && isLeadStatus(searchParams.status)
      ? searchParams.status
      : null;
  const rows = filter ? all.filter((l) => l.status === filter) : all;

  return (
    <div>
      <h2 className="mb-4 text-xl font-bold text-gray-900">Leads</h2>

      <div className="mb-5 flex flex-wrap gap-2 text-sm">
        <FilterChip label={`All (${all.length})`} href="/dashboard/leads" active={!filter} />
        {PIPELINE_STAGES.map((s) => {
          const n = all.filter((l) => l.status === s).length;
          return (
            <FilterChip
              key={s}
              label={`${statusLabel(s)} (${n})`}
              href={`/dashboard/leads?status=${s}`}
              active={filter === s}
            />
          );
        })}
      </div>

      {rows.length === 0 ? (
        all.length === 0 ? (
          <EmptyState
            title="No leads yet"
            description="Share a property's public listing link to start collecting inquiries — every submission lands here automatically."
            cta={{ href: "/dashboard/properties", label: "Open a property" }}
          />
        ) : (
          <EmptyState
            title="No leads in this stage"
            description="Try another stage filter above, or clear it to see every lead."
          />
        )
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Property</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Received</th>
                <th className="px-4 py-2 font-medium">Stage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <Link
                      href={`/dashboard/leads/${l.id}`}
                      className="font-medium text-gray-900 hover:text-brand"
                    >
                      {l.name || l.email || "Unnamed lead"}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {l.property?.address ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{l.source ?? "—"}</td>
                  <td className="px-4 py-2 text-gray-500">
                    {new Date(l.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2">
                    <StatusSelect leadId={l.id} status={l.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 font-medium transition ${
        active
          ? "border-transparent bg-brand text-white"
          : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
      }`}
    >
      {label}
    </Link>
  );
}

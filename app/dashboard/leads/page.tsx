import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import {
  PIPELINE_STAGES,
  statusLabel,
  isLeadStatus,
  type LeadStatus,
} from "@/lib/pipeline";
import {
  followUpStatus,
  followUpLabel,
  type FollowUpStatus,
} from "@/lib/lead-detail";
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
  next_action_at: string | null;
  property: { address: string } | null;
};

const FOLLOW_CHIP: Record<Exclude<FollowUpStatus, "none">, string> = {
  overdue: "bg-red-100 text-red-700",
  today: "bg-amber-100 text-amber-700",
  upcoming: "bg-gray-100 text-gray-600",
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
      "id, name, email, phone, source, status, created_at, next_action_at, property:properties(address)",
    )
    .order("created_at", { ascending: false });

  const all = (data ?? []) as unknown as LeadRow[];
  const org = await getCurrentOrg();
  const timeZone = org?.booking_timezone ?? "America/Toronto";
  const today = new Date().toLocaleDateString("en-CA", { timeZone });
  const filter =
    searchParams.status && isLeadStatus(searchParams.status)
      ? searchParams.status
      : null;
  const rows = filter ? all.filter((l) => l.status === filter) : all;

  return (
    <div>
      <h2 className="mb-4 text-xl font-bold text-gray-900">Inquiries</h2>

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
            title="No inquiries yet"
            description="Share a property's public listing link to start collecting inquiries. Every submission lands here automatically."
            cta={{ href: "/dashboard/properties", label: "Open a property" }}
          />
        ) : (
          <EmptyState
            title="No inquiries in this stage"
            description="Try another stage filter above, or clear it to see every inquiry."
          />
        )
      ) : (
        <>
          {/* Mobile: a card per inquiry (the table is too cramped on phones). */}
          <ul className="space-y-3 md:hidden">
            {rows.map((l) => {
              const fStatus = followUpStatus(l.next_action_at, today);
              return (
                <li
                  key={l.id}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/dashboard/leads/${l.id}`}
                      className="font-semibold text-gray-900 hover:text-brand"
                    >
                      {l.name || l.email || "Unnamed renter"}
                    </Link>
                    {fStatus !== "none" && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${FOLLOW_CHIP[fStatus]}`}
                      >
                        {followUpLabel(l.next_action_at, today)}
                      </span>
                    )}
                  </div>
                  <dl className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-400">Rental</dt>
                      <dd className="text-right text-gray-700">
                        {l.property?.address ?? "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-400">Source</dt>
                      <dd className="text-right text-gray-700">
                        {l.source ?? "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-400">Received</dt>
                      <dd className="text-right text-gray-500">
                        {new Date(l.created_at).toLocaleDateString()}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <StatusSelect leadId={l.id} status={l.status} />
                  </div>
                </li>
              );
            })}
          </ul>

          {/* md+ : the full table. */}
          <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm md:block">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Rental</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Received</th>
                  <th className="px-4 py-2 font-medium">Stage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((l) => {
                  const fStatus = followUpStatus(l.next_action_at, today);
                  return (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <Link
                        href={`/dashboard/leads/${l.id}`}
                        className="font-medium text-gray-900 hover:text-brand"
                      >
                        {l.name || l.email || "Unnamed renter"}
                      </Link>
                      {fStatus !== "none" && (
                        <span
                          className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${FOLLOW_CHIP[fStatus]}`}
                        >
                          {followUpLabel(l.next_action_at, today)}
                        </span>
                      )}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
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

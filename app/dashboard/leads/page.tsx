import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import {
  PIPELINE_STAGES,
  statusLabel,
  statusDescription,
  isLeadStatus,
  type LeadStatus,
} from "@/lib/pipeline";
import {
  isScreenFilter,
  matchesScreenFilter,
  type ScreenFilter,
} from "@/lib/screening";
import {
  followUpStatus,
  followUpLabel,
  type FollowUpStatus,
} from "@/lib/lead-detail";
import { BrandBanner, EmptyState } from "@/components/ui";
import { Icons } from "@/components/icons";
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
  qualified_out: boolean;
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
  searchParams: { status?: string; screen?: string };
}) {
  const supabase = createClient();
  const { data } = await supabase
    .from("leads")
    .select(
      "id, name, email, phone, source, status, created_at, next_action_at, qualified_out, property:properties(address)",
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
  const screen: ScreenFilter | null = isScreenFilter(searchParams.screen)
    ? searchParams.screen
    : null;
  // Stage and screening filters are orthogonal — apply both.
  const rows = all.filter(
    (l) =>
      (filter ? l.status === filter : true) &&
      matchesScreenFilter(l.qualified_out, screen),
  );

  // The screening filter row only appears once an org actually has flagged
  // leads — orgs that never enabled screening never see the cue.
  const mismatchCount = all.filter((l) => l.qualified_out).length;
  const fitCount = all.length - mismatchCount;
  const showScreenFilter = mismatchCount > 0;

  return (
    <div>
      <BrandBanner
        icon={<Icons.chat />}
        eyebrow="Renters"
        title="Inquiries"
        subtitle="Every renter who has reached out about one of your rentals."
      />

      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <FilterChip
          label={`All (${all.length})`}
          href={leadsHref(null, screen)}
          active={!filter}
        />
        {PIPELINE_STAGES.map((s) => {
          const n = all.filter((l) => l.status === s).length;
          return (
            <FilterChip
              key={s}
              label={`${statusLabel(s)} (${n})`}
              href={leadsHref(s, screen)}
              active={filter === s}
            />
          );
        })}
      </div>

      {showScreenFilter && (
        <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
            Screening
          </span>
          <FilterChip
            label="All fits"
            href={leadsHref(filter, null)}
            active={!screen}
          />
          <FilterChip
            label={`Good fits (${fitCount})`}
            href={leadsHref(filter, "ok")}
            active={screen === "ok"}
          />
          <FilterChip
            label={`Possible mismatch (${mismatchCount})`}
            href={leadsHref(filter, "out")}
            active={screen === "out"}
          />
        </div>
      )}

      <details className="mb-5 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
          What the stages mean
        </summary>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 rounded-2xl border border-gray-200 bg-gray-50 p-3 sm:grid-cols-2">
          {PIPELINE_STAGES.map((s) => (
            <div key={s} className="flex gap-2">
              <dt className="shrink-0 font-medium text-gray-700">
                {statusLabel(s)}:
              </dt>
              <dd className="text-gray-500">{statusDescription(s)}</dd>
            </div>
          ))}
        </dl>
      </details>

      {rows.length === 0 ? (
        all.length === 0 ? (
          <EmptyState
            icon={<Icons.chat />}
            title="No inquiries yet"
            description="Share a rental's public listing link to start collecting inquiries. Every submission lands here automatically."
            cta={{ href: "/dashboard/properties", label: "Open a rental" }}
          />
        ) : (
          <EmptyState
            icon={<Icons.chat />}
            title="No inquiries match these filters"
            description="Try another filter above, or clear them to see every inquiry."
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
                  className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <Link
                        href={`/dashboard/leads/${l.id}`}
                        className="font-semibold text-gray-900 hover:text-brand"
                      >
                        {l.name || l.email || "Unnamed renter"}
                      </Link>
                      {l.qualified_out && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          Possible mismatch
                        </span>
                      )}
                    </span>
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
                        {new Date(l.created_at).toLocaleDateString("en-CA", { timeZone })}
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
          <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm md:block">
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
                      {l.qualified_out && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          Possible mismatch
                        </span>
                      )}
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
                      {new Date(l.created_at).toLocaleDateString("en-CA", { timeZone })}
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

/**
 * Build a /dashboard/leads URL preserving whichever of the two orthogonal
 * filters (stage + screening) you are NOT currently changing, so clicking a
 * screening chip keeps the active stage and vice-versa.
 */
function leadsHref(
  status: LeadStatus | null,
  screen: ScreenFilter | null,
): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (screen) params.set("screen", screen);
  const qs = params.toString();
  return qs ? `/dashboard/leads?${qs}` : "/dashboard/leads";
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

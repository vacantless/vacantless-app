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
import { BrandBanner, EmptyState } from "@/components/ui";
import { Icons } from "@/components/icons";
import { TriageQueue } from "./triage-queue";

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
  property_id: string | null;
  property: { address: string } | null;
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: { status?: string; screen?: string; property?: string };
}) {
  const supabase = createClient();
  const { data } = await supabase
    .from("leads")
    .select(
      "id, name, email, phone, source, status, created_at, next_action_at, qualified_out, property_id, property:properties(address)",
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

  // Per-rental scope: deep-links from a rental's lifecycle rail land here
  // filtered to that one unit. The stage + screening chips then count and
  // filter WITHIN the unit, so the queue reads as "this rental's inquiries".
  const propertyId =
    typeof searchParams.property === "string" && searchParams.property
      ? searchParams.property
      : null;
  const propertyAddress = propertyId
    ? (all.find((l) => l.property_id === propertyId)?.property?.address ??
        null)
    : null;
  const scoped = propertyId
    ? all.filter((l) => l.property_id === propertyId)
    : all;

  // Stage and screening filters are orthogonal — apply both, within scope.
  const rows = scoped.filter(
    (l) =>
      (filter ? l.status === filter : true) &&
      matchesScreenFilter(l.qualified_out, screen),
  );

  // The screening filter row only appears once the (scoped) set actually has
  // flagged leads — orgs that never enabled screening never see the cue.
  const mismatchCount = scoped.filter((l) => l.qualified_out).length;
  const fitCount = scoped.length - mismatchCount;
  const showScreenFilter = mismatchCount > 0;

  return (
    <div>
      <BrandBanner
        icon={<Icons.chat />}
        eyebrow="Renters"
        title="Inquiries"
        subtitle="Every renter who has reached out about one of your rentals."
      />

      {propertyId && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/20 bg-brand/5 px-4 py-3 text-sm">
          <span className="text-gray-700">
            Showing inquiries for{" "}
            <span className="font-semibold text-gray-900">
              {propertyAddress ?? "this rental"}
            </span>
          </span>
          <Link
            href="/dashboard/leads"
            className="shrink-0 font-medium text-brand hover:underline"
          >
            Show all rentals
          </Link>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <FilterChip
          label={`All (${scoped.length})`}
          href={leadsHref(null, screen, propertyId)}
          active={!filter}
        />
        {PIPELINE_STAGES.map((s) => {
          const n = scoped.filter((l) => l.status === s).length;
          return (
            <FilterChip
              key={s}
              label={`${statusLabel(s)} (${n})`}
              href={leadsHref(s, screen, propertyId)}
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
            href={leadsHref(filter, null, propertyId)}
            active={!screen}
          />
          <FilterChip
            label={`Good fits (${fitCount})`}
            href={leadsHref(filter, "ok", propertyId)}
            active={screen === "ok"}
          />
          <FilterChip
            label={`Possible mismatch (${mismatchCount})`}
            href={leadsHref(filter, "out", propertyId)}
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
        <TriageQueue rows={rows} today={today} timeZone={timeZone} />
      )}
    </div>
  );
}

/**
 * Build a /dashboard/leads URL preserving whichever of the orthogonal filters
 * (stage + screening) you are NOT currently changing, so clicking a screening
 * chip keeps the active stage and vice-versa. The per-rental scope always rides
 * along — switching stage/screening chips stays within the same unit.
 */
function leadsHref(
  status: LeadStatus | null,
  screen: ScreenFilter | null,
  property: string | null,
): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (screen) params.set("screen", screen);
  if (property) params.set("property", property);
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

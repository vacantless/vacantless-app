import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  TENANCY_STATUSES,
  tenancyStatusLabel,
  formatRentCents,
  tenancyErrorMessage,
} from "@/lib/tenancy";
import {
  StatusChip,
  tenancyStatusTone,
  EmptyState,
  PageHeader,
  PRIMARY_ACTION_CLASS,
  SECONDARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";

export const dynamic = "force-dynamic";

type TenantRow = { name: string | null; is_primary: boolean };
type TenancyRow = {
  id: string;
  status: string;
  rent_cents: number | null;
  start_date: string;
  end_date: string | null;
  property: { address: string } | null;
  tenants: TenantRow[];
};

// Active first, then upcoming, then ended.
const STATUS_ORDER: Record<string, number> = { active: 0, upcoming: 1, ended: 2 };

function tenantSummary(tenants: TenantRow[]): string {
  if (tenants.length === 0) return "No tenants on file";
  const primary = tenants.find((t) => t.is_primary) ?? tenants[0];
  const primaryName = primary.name ?? "Unnamed tenant";
  const others = tenants.length - 1;
  return others > 0
    ? `${primaryName} +${others} ${others === 1 ? "co-tenant" : "co-tenants"}`
    : primaryName;
}

export default async function TenanciesPage({
  searchParams,
}: {
  searchParams: { created?: string; deleted?: string; forbidden?: string };
}) {
  const supabase = createClient();
  const { data } = await supabase
    .from("tenancies")
    .select(
      "id, status, rent_cents, start_date, end_date, property:properties(address), tenants(name, is_primary)",
    )
    .order("start_date", { ascending: false });

  const rows = ((data ?? []) as unknown as TenancyRow[]).slice().sort((a, b) => {
    const sa = STATUS_ORDER[a.status] ?? 9;
    const sb = STATUS_ORDER[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return a.start_date < b.start_date ? 1 : -1;
  });

  const activeCount = rows.filter((r) => r.status === "active").length;
  const forbidden = tenancyErrorMessage(searchParams.forbidden ? "forbidden" : undefined);

  return (
    <div>
      <PageHeader
        icon={<Icons.key />}
        eyebrow="Leases & tenants"
        title="Tenancies"
        subtitle="Your active leases. Each tenancy links a tenant to a unit with the signed rent and lease dates — the record rent collection and tenant messaging build on."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/dashboard/tenancies/message-templates"
              className={SECONDARY_ACTION_CLASS}
            >
              Message templates
            </Link>
            <Link href="/dashboard/tenancies/watch" className={SECONDARY_ACTION_CLASS}>
              Watch a lease
            </Link>
            <Link
              href="/dashboard/tenancies/new"
              className={PRIMARY_ACTION_CLASS}
              style={{ backgroundColor: "var(--brand-color)" }}
            >
              + Add tenancy
            </Link>
          </div>
        }
      />

      {searchParams.created && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Tenancy created.
        </p>
      )}
      {searchParams.deleted && (
        <p className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-600">
          Tenancy deleted.
        </p>
      )}
      {forbidden && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          {forbidden}
        </p>
      )}

      {rows.length > 0 ? (
        <>
          <p className="mb-3 text-sm text-gray-500">
            {activeCount} active {activeCount === 1 ? "tenancy" : "tenancies"} ·{" "}
            {rows.length} total
          </p>
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            {rows.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/dashboard/tenancies/${t.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 hover:bg-gray-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-gray-900">
                      {tenantSummary(t.tenants)}
                    </span>
                    <span className="block truncate text-xs text-gray-500">
                      {t.property?.address ?? "Unit removed"} · from{" "}
                      {t.start_date}
                      {t.end_date ? ` to ${t.end_date}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-sm text-gray-500">
                      {formatRentCents(t.rent_cents)}
                      {t.rent_cents != null ? "/mo" : ""}
                    </span>
                    <StatusChip tone={tenancyStatusTone(t.status)}>
                      {tenancyStatusLabel(t.status)}
                    </StatusChip>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState
          icon={<Icons.key />}
          title="No tenancies yet"
          description="When a renter signs a lease, mark their inquiry Leased and use Convert to tenancy — or add one directly here for a unit that's already occupied."
          cta={{ href: "/dashboard/tenancies/new", label: "Add a tenancy" }}
        />
      )}

      <p className="mt-6 text-xs text-gray-400">
        Statuses: {TENANCY_STATUSES.map((s) => tenancyStatusLabel(s)).join(" · ")}
      </p>
    </div>
  );
}

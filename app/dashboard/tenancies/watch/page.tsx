import Link from "next/link";
import { PageHeader, SECONDARY_ACTION_CLASS } from "@/components/ui";
import { Icons } from "@/components/icons";
import { createClient } from "@/lib/supabase/server";
import { watchLeaseErrorMessage } from "@/lib/watch-lease";
import { watchLease } from "../actions";

export const dynamic = "force-dynamic";

const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

/** Dollars string for a number input default (cents -> "1250" or "1250.50"). */
function dollars(cents: number | null): string {
  return cents != null ? (cents / 100).toString() : "";
}

type ExistingTenancy = {
  id: string;
  rent_cents: number | null;
  start_date: string | null;
  last_rent_increase_date: string | null;
  property: {
    address: string | null;
    rent_control_exempt: boolean | null;
    first_occupancy_date: string | null;
  } | null;
  tenants: { name: string | null; is_primary: boolean | null }[] | null;
};

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return (rel as T) ?? null;
}

function primaryName(t: ExistingTenancy): string {
  const list = (t.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  return (list[0]?.name ?? "").trim() || "Tenant on file";
}

export default async function WatchLeasePage({
  searchParams,
}: {
  searchParams: { err?: string; tenancy?: string };
}) {
  const errMsg = watchLeaseErrorMessage(searchParams.err);
  const supabase = createClient();

  // --- Confirm-an-existing-tenancy (prefill) mode ----------------------------
  // Landing here with ?tenancy=<id> means the landlord is enrolling a lease the
  // app already holds (from the leasing pipeline) — so the unit + parties are
  // known and we PREFILL, asking only to confirm and add the rent-increase
  // fields. RLS scopes the read to the caller's org.
  if (searchParams.tenancy) {
    const { data } = await supabase
      .from("tenancies")
      .select(
        "id, rent_cents, start_date, last_rent_increase_date, " +
          "property:properties(address, rent_control_exempt, first_occupancy_date), " +
          "tenants(name, is_primary)",
      )
      .eq("id", searchParams.tenancy)
      .maybeSingle();
    const t = data as ExistingTenancy | null;

    if (t) {
      const prop = one(t.property);
      return (
        <div>
          <Link
            href={`/dashboard/tenancies/${t.id}`}
            className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
          >
            ← Back to tenancy
          </Link>

          <PageHeader
            icon={<Icons.calendar />}
            eyebrow="Rent-increase autopilot"
            title="Confirm this lease for rent-increase tracking"
            subtitle="The unit and tenant are already on file — just confirm the lease start and tell us when rent was last raised (and whether the unit is rent-control exempt). We'll remind you, well ahead of the deadline, when you can raise the rent — with the guideline amount and a pre-filled N1."
          />

          {errMsg && (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {errMsg}
            </p>
          )}

          <form
            action={watchLease}
            className="space-y-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
          >
            <input type="hidden" name="tenancy_id" value={t.id} />

            {/* Already-known facts (read-only confirm) ------------------- */}
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm">
              <p className="text-gray-500">From this tenancy</p>
              <p className="mt-1 font-medium text-gray-900">
                {prop?.address ?? "Unit on file"}
              </p>
              <p className="text-gray-600">{primaryName(t)}</p>
            </div>

            {/* Lease + increase fields ----------------------------------- */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Lease start</label>
                <input
                  type="date"
                  name="start_date"
                  required
                  defaultValue={t.start_date ?? ""}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Monthly rent ($)</label>
                <input
                  type="number"
                  name="rent"
                  step="0.01"
                  min="0"
                  defaultValue={dollars(t.rent_cents)}
                  className={inputCls}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Last rent increase (optional)</label>
                <input
                  type="date"
                  name="last_rent_increase_date"
                  defaultValue={t.last_rent_increase_date ?? ""}
                  className={`${inputCls} max-w-xs`}
                />
                <p className="mt-1 text-xs text-gray-400">
                  Leave blank if rent hasn&apos;t been raised since move-in — the
                  clock runs from the lease start.
                </p>
              </div>
            </div>

            {/* Exemption (owner-asserted) -------------------------------- */}
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  name="rent_control_exempt"
                  defaultChecked={prop?.rent_control_exempt === true}
                  className="mt-0.5"
                />
                <span>
                  This unit was first occupied after Nov 15, 2018 (rent-control
                  exempt).
                  <span className="mt-0.5 block text-xs text-gray-500">
                    You&apos;re responsible for this classification — we don&apos;t
                    determine it for you. When set, we won&apos;t cap the increase
                    to the provincial guideline.
                  </span>
                </span>
              </label>
              <div className="mt-3">
                <label className={labelCls}>First occupancy date (optional)</label>
                <input
                  type="date"
                  name="first_occupancy_date"
                  defaultValue={prop?.first_occupancy_date ?? ""}
                  className={`${inputCls} max-w-xs`}
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                style={{ background: "var(--brand-gradient, var(--brand-color))" }}
              >
                Confirm &amp; track rent increases
              </button>
              <Link href={`/dashboard/tenancies/${t.id}`} className={SECONDARY_ACTION_CLASS}>
                Cancel
              </Link>
            </div>
          </form>
        </div>
      );
    }
    // Fall through to create mode if the id didn't resolve (shows the picker +
    // a not-found note via ?err handling above).
  }

  // --- Create mode (standalone, no existing record) --------------------------
  // For the off-pipeline owner: capture a brand-new private unit + tenancy. We
  // also offer the prefill shortcut for any active tenancy already on file so an
  // owner who DID run the pipeline confirms instead of re-typing.
  const { data: activeRows } = await supabase
    .from("tenancies")
    .select(
      "id, rent_cents, start_date, property:properties(address), tenants(name, is_primary)",
    )
    .eq("status", "active")
    .order("start_date", { ascending: false });
  const active = (activeRows ?? []) as unknown as ExistingTenancy[];

  return (
    <div>
      <Link
        href="/dashboard/tenancies"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
      >
        ← Tenancies
      </Link>

      <PageHeader
        icon={<Icons.calendar />}
        eyebrow="Rent-increase autopilot"
        title="Watch a lease"
        subtitle="Add one existing lease and we'll remind you — well ahead of the deadline — when you can raise the rent, with the guideline amount and a pre-filled N1 ready to serve. Just the lease details; no marketing, screening, or rent collection setup."
      />

      {errMsg && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {errMsg}
        </p>
      )}

      {/* Prefill shortcut: confirm an existing tenancy instead of re-typing. */}
      {active.length > 0 && (
        <div className="mb-6 rounded-2xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm font-semibold text-gray-700">
            Already have this unit on file?
          </p>
          <p className="mb-3 text-xs text-gray-500">
            Confirm an existing lease to set up rent-increase tracking without
            re-typing the unit or tenant.
          </p>
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
            {active.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/dashboard/tenancies/watch?tenancy=${t.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-gray-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-gray-900">
                      {one(t.property)?.address ?? "Unit on file"}
                    </span>
                    <span className="block truncate text-xs text-gray-500">
                      {primaryName(t)} · from {t.start_date ?? "—"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-brand">
                    Confirm →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        action={watchLease}
        className="space-y-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        {/* Unit + lease ------------------------------------------------- */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelCls}>Unit address</label>
            <input
              name="address"
              required
              placeholder="833 Pillette Rd, Unit 20"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Monthly rent ($)</label>
            <input
              type="number"
              name="rent"
              step="0.01"
              min="0"
              placeholder="1250"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Lease start</label>
            <input type="date" name="start_date" required className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Last rent increase (optional)</label>
            <input
              type="date"
              name="last_rent_increase_date"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-gray-400">
              Leave blank if rent hasn&apos;t been raised since move-in — the clock
              runs from the lease start.
            </p>
          </div>
        </div>

        {/* Exemption (owner-asserted) ----------------------------------- */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              name="rent_control_exempt"
              className="mt-0.5"
            />
            <span>
              This unit was first occupied after Nov 15, 2018 (rent-control
              exempt).
              <span className="mt-0.5 block text-xs text-gray-500">
                You&apos;re responsible for this classification — we don&apos;t
                determine it for you. When set, we won&apos;t cap the increase to
                the provincial guideline.
              </span>
            </span>
          </label>
          <div className="mt-3">
            <label className={labelCls}>First occupancy date (optional)</label>
            <input
              type="date"
              name="first_occupancy_date"
              className={`${inputCls} max-w-xs`}
            />
          </div>
        </div>

        {/* Tenant ------------------------------------------------------- */}
        <div>
          <p className="mb-1 text-sm font-semibold text-gray-700">Tenant</p>
          <p className="mb-3 text-xs text-gray-500">
            Who&apos;s on the lease. Email and phone are optional — you can add
            co-tenants later from the tenancy page.
          </p>
          <div className="grid grid-cols-1 gap-2 rounded-xl border border-gray-200 p-3 sm:grid-cols-3">
            <input
              name="tenant_name"
              required
              placeholder="Full name"
              className={inputCls}
            />
            <input
              name="tenant_email"
              type="email"
              placeholder="Email (optional)"
              className={inputCls}
            />
            <input
              name="tenant_phone"
              placeholder="Phone (optional)"
              className={inputCls}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            style={{ background: "var(--brand-gradient, var(--brand-color))" }}
          >
            Watch this lease
          </button>
          <Link href="/dashboard/tenancies" className={SECONDARY_ACTION_CLASS}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

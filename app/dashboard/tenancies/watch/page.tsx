import Link from "next/link";
import { PageHeader, SECONDARY_ACTION_CLASS } from "@/components/ui";
import { Icons } from "@/components/icons";
import { watchLeaseErrorMessage } from "@/lib/watch-lease";
import { watchLease } from "../actions";

export const dynamic = "force-dynamic";

const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

export default function WatchLeasePage({
  searchParams,
}: {
  searchParams: { err?: string };
}) {
  const errMsg = watchLeaseErrorMessage(searchParams.err);

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
              step="1"
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

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  TENANCY_STATUSES,
  tenancyStatusLabel,
  tenancyErrorMessage,
  parseDateOrNull,
} from "@/lib/tenancy";
import { PageHeader, SECONDARY_ACTION_CLASS } from "@/components/ui";
import { Icons } from "@/components/icons";
import { createTenancy } from "../actions";

export const dynamic = "force-dynamic";

type PropertyOpt = { id: string; address: string; rent_cents: number | null };
type LeadPrefill = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  move_in: string | null;
  property_id: string | null;
  status: string;
};

const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

export default async function NewTenancyPage({
  searchParams,
}: {
  searchParams: { from?: string; err?: string };
}) {
  const supabase = createClient();

  const { data: propData } = await supabase
    .from("properties")
    .select("id, address, rent_cents")
    .order("address", { ascending: true });
  const properties = (propData ?? []) as PropertyOpt[];

  // Convert flow: prefill from a leased lead.
  let lead: LeadPrefill | null = null;
  if (searchParams.from) {
    const { data } = await supabase
      .from("leads")
      .select("id, name, email, phone, move_in, property_id, status")
      .eq("id", searchParams.from)
      .maybeSingle();
    lead = (data as LeadPrefill | null) ?? null;
  }

  const isConvert = lead != null;
  const defaultPropertyId = lead?.property_id ?? "";
  const leadProperty = properties.find((p) => p.id === defaultPropertyId);
  const defaultRent =
    leadProperty?.rent_cents != null
      ? (leadProperty.rent_cents / 100).toString()
      : "";
  const defaultStart =
    (lead?.move_in && parseDateOrNull(lead.move_in)) || "";

  const errMsg = tenancyErrorMessage(searchParams.err);

  return (
    <div>
      <Link
        href={isConvert ? `/dashboard/leads/${lead!.id}` : "/dashboard/tenancies"}
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
      >
        ← {isConvert ? "Back to inquiry" : "Tenancies"}
      </Link>

      <PageHeader
        icon={<Icons.key />}
        eyebrow={isConvert ? "Convert to tenancy" : "New tenancy"}
        title={isConvert ? "Review tenancy details" : "Add a tenancy"}
        subtitle={
          isConvert
            ? "We've prefilled what we know from the inquiry. Review and complete the lease details, then create the tenancy record."
            : "Record an active lease for a unit. The primary tenant is who rent collection will bill."
        }
      />

      {errMsg && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {errMsg}
        </p>
      )}

      {properties.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-sm text-gray-500">
          Add a rental first — a tenancy has to attach to a unit.{" "}
          <Link href="/dashboard/properties" className="font-medium text-brand hover:underline">
            Go to Rentals
          </Link>
        </div>
      ) : (
        <form
          action={createTenancy}
          className="space-y-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
        >
          {isConvert && <input type="hidden" name="lead_id" value={lead!.id} />}

          {/* Unit + dates ------------------------------------------------- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>Rental (unit)</label>
              <select name="property_id" required defaultValue={defaultPropertyId} className={inputCls}>
                <option value="">Select a rental…</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.address}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Lease start</label>
              <input type="date" name="start_date" required defaultValue={defaultStart} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Lease end (optional)</label>
              <input type="date" name="end_date" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Term (months — blank = month-to-month)</label>
              <input type="number" name="term_months" step="1" min="1" placeholder="12" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select name="status" defaultValue="active" className={inputCls}>
                {TENANCY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {tenancyStatusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Money -------------------------------------------------------- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Monthly rent ($)</label>
              <input
                type="number"
                name="rent"
                step="1"
                min="0"
                placeholder="1250"
                defaultValue={defaultRent}
                className={inputCls}
              />
              {isConvert && leadProperty?.rent_cents != null && (
                <p className="mt-1 text-xs text-gray-400">Prefilled from the unit — edit if the signed rent differs.</p>
              )}
            </div>
            <div>
              <label className={labelCls}>Deposit ($, optional)</label>
              <input type="number" name="deposit" step="1" min="0" placeholder="1250" className={inputCls} />
            </div>
          </div>

          {/* Tenants ------------------------------------------------------ */}
          <div>
            <p className="mb-1 text-sm font-semibold text-gray-700">Tenants</p>
            <p className="mb-3 text-xs text-gray-500">
              Add up to three. Mark one as primary — that's who rent collection bills.
            </p>
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="grid grid-cols-1 gap-2 rounded-xl border border-gray-200 p-3 sm:grid-cols-[auto_1fr_1fr_1fr]"
                >
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
                    <input
                      type="radio"
                      name="primary_index"
                      value={i}
                      defaultChecked={i === 0}
                    />
                    Primary
                  </label>
                  <input
                    name="tenant_name"
                    placeholder={i === 0 ? "Full name" : "Co-tenant name (optional)"}
                    defaultValue={i === 0 ? lead?.name ?? "" : ""}
                    className={inputCls}
                  />
                  <input
                    name="tenant_email"
                    type="email"
                    placeholder="Email"
                    defaultValue={i === 0 ? lead?.email ?? "" : ""}
                    className={inputCls}
                  />
                  <input
                    name="tenant_phone"
                    placeholder="Phone"
                    defaultValue={i === 0 ? lead?.phone ?? "" : ""}
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Notes -------------------------------------------------------- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Payment / deposit notes</label>
              <textarea name="payment_notes" rows={2} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Move-in notes</label>
              <textarea name="move_in_notes" rows={2} className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Other notes</label>
              <textarea name="notes" rows={2} className={inputCls} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
              style={{ background: "var(--brand-gradient, var(--brand-color))" }}
            >
              Create tenancy
            </button>
            <Link
              href={isConvert ? `/dashboard/leads/${lead!.id}` : "/dashboard/tenancies"}
              className={SECONDARY_ACTION_CLASS}
            >
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}

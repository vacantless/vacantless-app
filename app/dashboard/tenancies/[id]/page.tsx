import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  TENANCY_STATUSES,
  tenancyStatusLabel,
  tenancyErrorMessage,
  formatRentCents,
  MAX_TENANTS_PER_TENANCY,
} from "@/lib/tenancy";
import {
  PageHeader,
  SectionHeading,
  StatusChip,
  tenancyStatusTone,
  SECONDARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import {
  updateTenancy,
  endTenancy,
  deleteTenancy,
  addTenant,
  removeTenant,
  makePrimaryTenant,
} from "../actions";
import { createRotessaCustomer, createRotessaSchedule } from "../rotessa-actions";
import { defaultFirstProcessDate, minProcessDate, formatProcessDate } from "@/lib/rotessa";

export const dynamic = "force-dynamic";

type Tenant = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
};
type Tenancy = {
  id: string;
  status: string;
  rent_cents: number | null;
  deposit_cents: number | null;
  start_date: string;
  end_date: string | null;
  term_months: number | null;
  payment_notes: string | null;
  move_in_notes: string | null;
  notes: string | null;
  lead_id: string | null;
  rotessa_customer_id: string | null;
  rotessa_customer_synced_at: string | null;
  rotessa_schedule_id: string | null;
  rotessa_schedule_synced_at: string | null;
  property: { id: string; address: string } | null;
  tenants: Tenant[];
};

const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

function dollars(cents: number | null): string {
  return cents != null ? (cents / 100).toString() : "";
}

const FLASH: Record<string, string> = {
  saved: "Tenancy saved.",
  created: "Tenancy created.",
  ended: "Tenancy marked ended.",
};
const TENANT_FLASH: Record<string, string> = {
  added: "Tenant added.",
  removed: "Tenant removed.",
  primary: "Primary tenant updated.",
};
// Rotessa customer-creation outcomes (?rotessa=...). `created`/`already` are
// success-toned; the rest are errors.
const ROTESSA_SUCCESS: Record<string, string> = {
  created: "Rotessa customer created from the primary tenant. You can now set up rent collection for this tenancy.",
  already: "This tenancy already has a Rotessa customer.",
  scheduled: "Monthly rent schedule created in Rotessa. Payments will run automatically on the schedule.",
  schedalready: "This tenancy already has a rent schedule.",
};
const ROTESSA_ERROR: Record<string, string> = {
  notconnected: "Connect your Rotessa account in Settings before creating a customer.",
  noprimary: "This tenancy needs a primary tenant first.",
  noname: "Give the primary tenant a name before creating a Rotessa customer.",
  decfail: "We couldn't read your stored Rotessa key. Reconnect it in Settings.",
  createfail: "Rotessa couldn't create the customer. Check your connection in Settings and try again.",
  forbidden: "You don't have permission to manage rent collection.",
  nocustomer: "Create the Rotessa customer first, then set up the rent schedule.",
  norent: "Set a monthly rent amount on this tenancy before scheduling rent.",
  baddate: "Pick a first payment date at least 2 business days from today.",
  schedfail: "Rotessa couldn't create the rent schedule. The tenant may still need to authorize their bank in Rotessa. Check Settings and try again.",
};

export default async function TenancyDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: {
    saved?: string;
    created?: string;
    ended?: string;
    tenant?: string;
    err?: string;
    rotessa?: string;
  };
}) {
  const supabase = createClient();
  const { data } = await supabase
    .from("tenancies")
    .select(
      "id, status, rent_cents, deposit_cents, start_date, end_date, term_months, payment_notes, move_in_notes, notes, lead_id, rotessa_customer_id, rotessa_customer_synced_at, rotessa_schedule_id, rotessa_schedule_synced_at, property:properties(id, address), tenants(id, name, email, phone, is_primary)",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!data) notFound();
  const t = data as unknown as Tenancy;
  const tenants = (t.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const primary = tenants.find((x) => x.is_primary) ?? tenants[0] ?? null;

  // The org's Rotessa connection state (RLS scopes the row to this org). We
  // surface whether rent collection is connected so the Rent-collection card
  // below can show the right call-to-action; the stored key is never read here.
  const { data: rotessaRows } = await supabase
    .from("rotessa_accounts")
    .select("connection_status, api_key_encrypted")
    .limit(1);
  const rotessaRow = rotessaRows?.[0] as
    | { connection_status: string; api_key_encrypted: string | null }
    | undefined;
  const rotessaConnected = !!rotessaRow?.api_key_encrypted;
  const rotessaStatus = rotessaRow?.connection_status ?? "not_connected";
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultProcessDate = defaultFirstProcessDate(todayIso);
  const minProcDate = minProcessDate(todayIso);

  const flash =
    (searchParams.saved && FLASH.saved) ||
    (searchParams.created && FLASH.created) ||
    (searchParams.ended && FLASH.ended) ||
    (searchParams.tenant && TENANT_FLASH[searchParams.tenant]) ||
    (searchParams.rotessa && ROTESSA_SUCCESS[searchParams.rotessa]) ||
    null;
  const errMsg =
    tenancyErrorMessage(searchParams.err) ||
    (searchParams.rotessa ? ROTESSA_ERROR[searchParams.rotessa] ?? null : null);

  return (
    <div>
      <Link
        href="/dashboard/tenancies"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
      >
        ← Tenancies
      </Link>

      <PageHeader
        icon={<Icons.key />}
        eyebrow="Tenancy"
        title={primary?.name || primary?.email || "Tenancy"}
        subtitle={
          <>
            {t.property ? (
              <Link
                href={`/dashboard/properties/${t.property.id}`}
                className="font-medium text-brand hover:underline"
              >
                {t.property.address}
              </Link>
            ) : (
              "Unit removed"
            )}
            {" · "}
            {formatRentCents(t.rent_cents)}
            {t.rent_cents != null ? "/mo" : ""} · from {t.start_date}
            {t.end_date ? ` to ${t.end_date}` : ""}
          </>
        }
        action={
          <StatusChip tone={tenancyStatusTone(t.status)}>
            {tenancyStatusLabel(t.status)}
          </StatusChip>
        }
      />

      {flash && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {flash}
        </p>
      )}
      {errMsg && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {errMsg}
        </p>
      )}

      {/* Tenants roster --------------------------------------------------- */}
      <SectionHeading>Tenants</SectionHeading>
      <ul className="mb-3 divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {tenants.map((tn) => (
          <li key={tn.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <span className="min-w-0">
              <span className="text-gray-900">{tn.name || "Unnamed tenant"}</span>
              {tn.is_primary && (
                <StatusChip tone="brand">Primary</StatusChip>
              )}
              <span className="ml-2 block text-xs text-gray-500">
                {[tn.email, tn.phone].filter(Boolean).join(" · ") || "No contact details"}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {!tn.is_primary && (
                <form action={makePrimaryTenant}>
                  <input type="hidden" name="tenancy_id" value={t.id} />
                  <input type="hidden" name="tenant_id" value={tn.id} />
                  <button className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    Make primary
                  </button>
                </form>
              )}
              {tenants.length > 1 && (
                <form action={removeTenant}>
                  <input type="hidden" name="tenancy_id" value={t.id} />
                  <input type="hidden" name="tenant_id" value={tn.id} />
                  <button className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                    Remove
                  </button>
                </form>
              )}
            </span>
          </li>
        ))}
      </ul>
      {tenants.length < MAX_TENANTS_PER_TENANCY && (
        <form
          action={addTenant}
          className="mb-8 flex flex-wrap items-end gap-2 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
        >
          <input type="hidden" name="tenancy_id" value={t.id} />
          <div className="min-w-[10rem] flex-1">
            <label className={labelCls}>Add co-tenant — name</label>
            <input name="name" placeholder="Full name" className={inputCls} />
          </div>
          <div className="min-w-[10rem] flex-1">
            <label className={labelCls}>Email</label>
            <input name="email" type="email" className={inputCls} />
          </div>
          <div className="w-36">
            <label className={labelCls}>Phone</label>
            <input name="phone" className={inputCls} />
          </div>
          <button className={SECONDARY_ACTION_CLASS}>Add tenant</button>
        </form>
      )}

      {/* Lease details (edit) -------------------------------------------- */}
      <SectionHeading>Lease details</SectionHeading>
      <form
        action={updateTenancy}
        className="mb-8 space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <input type="hidden" name="id" value={t.id} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Lease start</label>
            <input type="date" name="start_date" required defaultValue={t.start_date} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Lease end (optional)</label>
            <input type="date" name="end_date" defaultValue={t.end_date ?? ""} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Term (months — blank = month-to-month)</label>
            <input
              type="number"
              name="term_months"
              step="1"
              min="1"
              defaultValue={t.term_months ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select name="status" defaultValue={t.status} className={inputCls}>
              {TENANCY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {tenancyStatusLabel(s)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Monthly rent ($)</label>
            <input type="number" name="rent" step="1" min="0" defaultValue={dollars(t.rent_cents)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Deposit ($)</label>
            <input type="number" name="deposit" step="1" min="0" defaultValue={dollars(t.deposit_cents)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Payment / deposit notes</label>
            <textarea name="payment_notes" rows={2} defaultValue={t.payment_notes ?? ""} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Move-in notes</label>
            <textarea name="move_in_notes" rows={2} defaultValue={t.move_in_notes ?? ""} className={inputCls} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Other notes</label>
            <textarea name="notes" rows={2} defaultValue={t.notes ?? ""} className={inputCls} />
          </div>
        </div>
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
          style={{ background: "var(--brand-gradient, var(--brand-color))" }}
        >
          Save changes
        </button>
      </form>

      {/* Rent collection (Rotessa) --------------------------------------- */}
      <SectionHeading>Rent collection</SectionHeading>
      <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        {t.rotessa_customer_id ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone="success">Customer on file</StatusChip>
              <span className="text-sm text-gray-600">
                {primary?.name || "Primary tenant"} is set up as a Rotessa customer.
              </span>
            </div>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-gray-500">Rotessa customer ID</dt>
                <dd className="font-mono text-xs text-gray-700">{t.rotessa_customer_id}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Created</dt>
                <dd className="font-medium text-gray-900">
                  {t.rotessa_customer_synced_at
                    ? new Date(t.rotessa_customer_synced_at).toLocaleString()
                    : "—"}
                </dd>
              </div>
            </dl>

            {/* Monthly rent schedule (increment 3) ------------------------ */}
            <div className="border-t border-gray-100 pt-4">
              {t.rotessa_schedule_id ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip tone="success">Rent schedule active</StatusChip>
                    <span className="text-sm text-gray-600">
                      {formatRentCents(t.rent_cents)}/mo, billed monthly to the primary tenant.
                    </span>
                  </div>
                  <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-gray-500">Rotessa schedule ID</dt>
                      <dd className="font-mono text-xs text-gray-700">{t.rotessa_schedule_id}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Set up</dt>
                      <dd className="font-medium text-gray-900">
                        {t.rotessa_schedule_synced_at
                          ? new Date(t.rotessa_schedule_synced_at).toLocaleString()
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-xs text-gray-400">
                    Payments run automatically. Manage or cancel the schedule from
                    your Rotessa dashboard.
                  </p>
                </div>
              ) : t.rent_cents == null ? (
                <p className="text-sm text-gray-600">
                  Set a monthly rent amount in Lease details below, then you can
                  schedule automatic rent collection.
                </p>
              ) : (
                <form action={createRotessaSchedule} className="space-y-3">
                  <input type="hidden" name="tenancy_id" value={t.id} />
                  <p className="text-sm text-gray-600">
                    Schedule automatic monthly rent of{" "}
                    <span className="font-medium text-gray-900">{formatRentCents(t.rent_cents)}</span>{" "}
                    starting on your chosen date. Your tenant must have authorized
                    their bank in Rotessa first.
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className={labelCls}>First payment date</label>
                      <input
                        type="date"
                        name="process_date"
                        required
                        min={minProcDate}
                        defaultValue={defaultProcessDate}
                        className={inputCls}
                      />
                      <span className="mt-1 block text-xs text-gray-400">
                        At least 2 business days out (e.g. {formatProcessDate(defaultProcessDate)}).
                      </span>
                    </div>
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                      style={{ background: "var(--brand-gradient, var(--brand-color))" }}
                    >
                      Set up monthly rent
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        ) : !rotessaConnected ? (
          <p className="text-sm text-gray-600">
            Connect your Rotessa account in{" "}
            <Link href="/dashboard/settings#rotessa" className="font-medium text-brand hover:underline">
              Settings
            </Link>{" "}
            to collect rent by pre-authorized debit for this tenancy.
          </p>
        ) : !primary?.name ? (
          <p className="text-sm text-gray-600">
            Add a name to the primary tenant above before creating a Rotessa
            customer.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Create a Rotessa customer for{" "}
              <span className="font-medium text-gray-900">{primary.name}</span>{" "}
              (the primary tenant) to start collecting rent. We send only their
              name and contact details — never bank account numbers.
            </p>
            {rotessaStatus === "error" && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Your last Rotessa connection check reported an error. If creating
                the customer fails, re-test the connection in Settings.
              </p>
            )}
            <form action={createRotessaCustomer}>
              <input type="hidden" name="tenancy_id" value={t.id} />
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                style={{ background: "var(--brand-gradient, var(--brand-color))" }}
              >
                Create Rotessa customer
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Lifecycle actions ----------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        {t.status !== "ended" && (
          <form action={endTenancy}>
            <input type="hidden" name="id" value={t.id} />
            <button className={SECONDARY_ACTION_CLASS}>End tenancy</button>
          </form>
        )}
        <form action={deleteTenancy}>
          <input type="hidden" name="id" value={t.id} />
          <button className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50">
            Delete tenancy
          </button>
        </form>
        <p className="text-xs text-gray-400">
          Ending keeps the record; deleting removes it and its tenants permanently.
        </p>
      </div>
    </div>
  );
}

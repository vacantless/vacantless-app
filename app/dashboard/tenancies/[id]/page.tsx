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
import TenancyStripeRentSection, {
  type TenancyStripeRentView,
} from "@/components/tenancy-stripe-rent-section";
import { getStripe } from "@/lib/stripe";
import { recordPayment, deletePayment } from "../payment-actions";
import { sendTenantMessage } from "../comms-actions";
import {
  PAYMENT_METHODS,
  paymentMethodLabel,
  paymentErrorMessage,
  formatMoneyCents,
  formatPeriodMonth,
  reconcilePayments,
  type PaymentRow,
} from "@/lib/payments";
import { channelLabel, commsErrorMessage } from "@/lib/tenant-comms";
import TenantMessageComposer, {
  type ComposerTenant,
  type ComposerTemplate,
} from "@/components/tenant-message-composer";

export const dynamic = "force-dynamic";

type Tenant = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  sms_opt_out: boolean;
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
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  stripe_mandate_status: string | null;
  stripe_rent_synced_at: string | null;
  property: { id: string; address: string } | null;
  tenants: Tenant[];
};

type Payment = {
  id: string;
  amount_cents: number;
  method: string;
  paid_on: string;
  period_month: string | null;
  reference: string | null;
  note: string | null;
};

type TenantMessageRow = {
  id: string;
  channel: string;
  subject: string | null;
  body: string;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  created_at: string;
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
// Manual payment outcomes (?paid=...). `recorded`/`deleted` are success-toned;
// the rest are validation errors handled by paymentErrorMessage.
const PAYMENT_FLASH: Record<string, string> = {
  recorded: "Payment recorded.",
  deleted: "Payment removed.",
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
// Stripe Connect rent outcomes (?striperent=...). `synced` is success-toned.
const STRIPE_RENT_SUCCESS: Record<string, string> = {
  synced: "Stripe rent status refreshed.",
};
const STRIPE_RENT_ERROR: Record<string, string> = {
  notconfigured: "Payments aren't configured on this deployment yet.",
  notconnected: "Set up Stripe rent collection in Settings first.",
  notready: "Finish your Stripe onboarding in Settings — it can't collect payments yet.",
  noprimary: "This tenancy needs a primary tenant first.",
  noname: "Give the primary tenant a name before starting Stripe authorization.",
  noemail: "The primary tenant needs an email — bank mandates and notices are sent there.",
  nosession: "Start the bank authorization before refreshing.",
  createfail: "Stripe couldn't start the authorization. Try again.",
  linkfail: "Stripe couldn't create the authorization link. Try again.",
  syncfail: "We couldn't refresh the Stripe status just now. Try again.",
  forbidden: "You don't have permission to manage rent collection.",
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
    striperent?: string;
    paid?: string;
    msg?: string;
    s?: string;
    k?: string;
    f?: string;
  };
}) {
  const supabase = createClient();
  const { data } = await supabase
    .from("tenancies")
    .select(
      "id, status, rent_cents, deposit_cents, start_date, end_date, term_months, payment_notes, move_in_notes, notes, lead_id, rotessa_customer_id, rotessa_customer_synced_at, rotessa_schedule_id, rotessa_schedule_synced_at, stripe_customer_id, stripe_payment_method_id, stripe_mandate_status, stripe_rent_synced_at, property:properties(id, address), tenants(id, name, email, phone, is_primary, sms_opt_out)",
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

  // The org's Stripe Connect rent rail state (sibling of Rotessa). RLS scopes
  // to this org. Drives the Stripe rent-collection section below.
  const { data: stripeConnectRows } = await supabase
    .from("stripe_connect_accounts")
    .select("connected_account_id, country, charges_enabled, onboarding_state")
    .limit(1);
  const stripeConnectRow = stripeConnectRows?.[0] as
    | { connected_account_id: string; country: string | null; charges_enabled: boolean; onboarding_state: string }
    | undefined;
  const stripeRentView: TenancyStripeRentView = {
    tenancyId: t.id,
    primaryName: primary?.name ?? null,
    primaryHasEmail: !!primary?.email,
    country: stripeConnectRow?.country ?? null,
    connectExists: !!stripeConnectRow?.connected_account_id,
    connectReady: !!stripeConnectRow?.charges_enabled,
    mandateStatus: t.stripe_mandate_status ?? "none",
    paymentMethodId: t.stripe_payment_method_id,
    syncedAt: t.stripe_rent_synced_at,
    stripeConfigured: !!getStripe(),
  };
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultProcessDate = defaultFirstProcessDate(todayIso);
  const minProcDate = minProcessDate(todayIso);
  const thisMonth = todayIso.slice(0, 7); // "YYYY-MM" for the period <input type="month">

  // Manual rent payments recorded against this tenancy (newest first). RLS
  // scopes to this org. We reconcile them against the monthly rent below.
  const { data: paymentRows } = await supabase
    .from("rent_payments")
    .select("id, amount_cents, method, paid_on, period_month, reference, note")
    .eq("tenancy_id", t.id)
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false });
  const payments = (paymentRows ?? []) as Payment[];
  const reconciliation = reconcilePayments(
    payments.map((p): PaymentRow => ({ amount_cents: p.amount_cents, period_month: p.period_month })),
    t.rent_cents,
  );

  // Org-level saved message templates (for the composer's "start from template"
  // picker) and the send history for this tenancy. RLS scopes both to this org.
  const { data: templateRows } = await supabase
    .from("tenant_message_templates")
    .select("id, name, channel, subject, body")
    .order("name", { ascending: true });
  const templates = (templateRows ?? []) as ComposerTemplate[];

  const { data: messageRows } = await supabase
    .from("tenant_messages")
    .select(
      "id, channel, subject, body, recipient_count, sent_count, failed_count, skipped_count, created_at",
    )
    .eq("tenancy_id", t.id)
    .order("created_at", { ascending: false })
    .limit(20);
  const messages = (messageRows ?? []) as TenantMessageRow[];

  const composerTenants: ComposerTenant[] = tenants.map((tn) => ({
    id: tn.id,
    name: tn.name,
    email: tn.email,
    phone: tn.phone,
    sms_opt_out: tn.sms_opt_out,
  }));

  // Tenant-message send outcome (?msg=...). `sent` is success (with counts);
  // `noone` means everyone selected was skipped; the rest are validation errors.
  const msgCounts = {
    s: parseInt(searchParams.s ?? "0", 10) || 0,
    k: parseInt(searchParams.k ?? "0", 10) || 0,
    f: parseInt(searchParams.f ?? "0", 10) || 0,
  };
  const msgFlash =
    searchParams.msg === "sent"
      ? `Message sent to ${msgCounts.s} recipient${msgCounts.s === 1 ? "" : "s"}.` +
        (msgCounts.k > 0 ? ` ${msgCounts.k} skipped (no contact details or opted out).` : "") +
        (msgCounts.f > 0 ? ` ${msgCounts.f} failed to send.` : "")
      : null;
  const msgError =
    searchParams.msg === "failed"
      ? "We couldn't send the message. Check that email/SMS is configured and try again."
      : searchParams.msg === "noone"
        ? "Nobody was messaged — the selected tenants have no usable contact details for that channel (or opted out of texts)."
        : searchParams.msg && searchParams.msg !== "sent"
          ? commsErrorMessage(searchParams.msg)
          : null;

  const flash =
    (searchParams.saved && FLASH.saved) ||
    (searchParams.created && FLASH.created) ||
    (searchParams.ended && FLASH.ended) ||
    (searchParams.tenant && TENANT_FLASH[searchParams.tenant]) ||
    (searchParams.rotessa && ROTESSA_SUCCESS[searchParams.rotessa]) ||
    (searchParams.striperent && STRIPE_RENT_SUCCESS[searchParams.striperent]) ||
    (searchParams.paid && PAYMENT_FLASH[searchParams.paid]) ||
    msgFlash ||
    null;
  const errMsg =
    tenancyErrorMessage(searchParams.err) ||
    (searchParams.rotessa ? ROTESSA_ERROR[searchParams.rotessa] ?? null : null) ||
    (searchParams.striperent && !STRIPE_RENT_SUCCESS[searchParams.striperent]
      ? STRIPE_RENT_ERROR[searchParams.striperent] ?? null
      : null) ||
    (searchParams.paid && !PAYMENT_FLASH[searchParams.paid]
      ? paymentErrorMessage(searchParams.paid)
      : null) ||
    msgError;

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

      {/* Rent collection (Stripe Connect — sibling rail to Rotessa) ------- */}
      <TenancyStripeRentSection view={stripeRentView} />

      {/* Manual payments (e-transfer / cheque / cash) -------------------- */}
      <SectionHeading>Payments received</SectionHeading>
      <div className="mb-8 space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-gray-600">
          Record rent you collected manually (e-transfer, cheque, or cash) and
          reconcile it against the monthly rent. This is a bookkeeping log — no
          money moves here. For automatic pre-authorized debit, use rent
          collection above.
        </p>

        {/* Reconcile summary by rent period */}
        {payments.length > 0 && (
          <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Reconciliation
              </span>
              <span className="text-sm text-gray-700">
                Total collected:{" "}
                <span className="font-semibold text-gray-900">
                  {formatMoneyCents(reconciliation.totalCollectedCents)}
                </span>
              </span>
            </div>
            <ul className="divide-y divide-gray-100">
              {reconciliation.buckets.map((b) => (
                <li
                  key={b.period ?? "unassigned"}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-gray-900">{b.label}</span>
                    {b.status === "paid" && b.expectedCents != null && (
                      <StatusChip tone="success">Paid</StatusChip>
                    )}
                    {b.status === "short" && <StatusChip tone="warn">Short</StatusChip>}
                    {b.status === "over" && <StatusChip tone="info">Over</StatusChip>}
                    {b.status === "unassigned" && (
                      <StatusChip tone="neutral">Unassigned</StatusChip>
                    )}
                    <span className="text-xs text-gray-400">
                      {b.count} payment{b.count === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="text-gray-700">
                    {formatMoneyCents(b.collectedCents)}
                    {b.expectedCents != null && (
                      <span className="text-gray-400">
                        {" / "}
                        {formatMoneyCents(b.expectedCents)}
                        {b.balanceCents != null && b.balanceCents !== 0 && (
                          <span
                            className={
                              b.balanceCents < 0 ? "text-amber-600" : "text-blue-600"
                            }
                          >
                            {" ("}
                            {b.balanceCents < 0 ? "" : "+"}
                            {formatMoneyCents(b.balanceCents)}
                            {")"}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Ledger of individual payments */}
        {payments.length > 0 && (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
            {payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium text-gray-900">
                    {formatMoneyCents(p.amount_cents)}
                  </span>
                  <span className="ml-2 text-gray-500">
                    {paymentMethodLabel(p.method)} · {p.paid_on}
                  </span>
                  <span className="ml-2 block text-xs text-gray-400">
                    {formatPeriodMonth(p.period_month)}
                    {p.reference ? ` · Ref ${p.reference}` : ""}
                    {p.note ? ` · ${p.note}` : ""}
                  </span>
                </span>
                <form action={deletePayment} className="shrink-0">
                  <input type="hidden" name="tenancy_id" value={t.id} />
                  <input type="hidden" name="payment_id" value={p.id} />
                  <button className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {/* Record-payment form */}
        <form
          action={recordPayment}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4"
        >
          <input type="hidden" name="tenancy_id" value={t.id} />
          <div className="w-28">
            <label className={labelCls}>Amount ($)</label>
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0"
              required
              defaultValue={dollars(t.rent_cents)}
              className={inputCls}
            />
          </div>
          <div className="w-36">
            <label className={labelCls}>Method</label>
            <select name="method" defaultValue="e_transfer" className={inputCls}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {paymentMethodLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="w-40">
            <label className={labelCls}>Date received</label>
            <input
              name="paid_on"
              type="date"
              required
              defaultValue={todayIso}
              className={inputCls}
            />
          </div>
          <div className="w-36">
            <label className={labelCls}>For month (optional)</label>
            <input name="period_month" type="month" defaultValue={thisMonth} className={inputCls} />
          </div>
          <div className="w-32">
            <label className={labelCls}>Reference (optional)</label>
            <input name="reference" placeholder="Cheque #" className={inputCls} />
          </div>
          <div className="min-w-[8rem] flex-1">
            <label className={labelCls}>Note (optional)</label>
            <input name="note" className={inputCls} />
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            style={{ background: "var(--brand-gradient, var(--brand-color))" }}
          >
            Record payment
          </button>
        </form>
      </div>

      {/* Tenant messages (email / SMS) ----------------------------------- */}
      <SectionHeading>Tenant messages</SectionHeading>
      <div className="mb-8 space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-gray-600">
          Message the tenants on this tenancy by email and/or text — rent
          reminders, maintenance notices, or general updates. Messages send under
          your brand; replies come back to your reply-to address.{" "}
          <Link href="/dashboard/settings#templates" className="font-medium text-brand hover:underline">
            Manage saved templates
          </Link>
          .
        </p>

        {tenants.length === 0 ? (
          <p className="text-sm text-gray-500">Add a tenant above to send a message.</p>
        ) : (
          <TenantMessageComposer
            tenancyId={t.id}
            tenants={composerTenants}
            templates={templates}
            sendAction={sendTenantMessage}
          />
        )}

        {/* Message history */}
        {messages.length > 0 && (
          <div className="border-t border-gray-100 pt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Sent history
            </h3>
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
              {messages.map((m) => (
                <li key={m.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="font-medium text-gray-900">
                        {m.subject || (m.channel === "sms" ? "Text message" : "(no subject)")}
                      </span>
                      <span className="ml-2 text-xs text-gray-400">
                        {channelLabel(m.channel)} · {new Date(m.created_at).toLocaleString()}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-gray-500">
                      {m.sent_count} sent
                      {m.failed_count > 0 ? `, ${m.failed_count} failed` : ""}
                      {m.skipped_count > 0 ? `, ${m.skipped_count} skipped` : ""}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-gray-500">{m.body}</p>
                </li>
              ))}
            </ul>
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

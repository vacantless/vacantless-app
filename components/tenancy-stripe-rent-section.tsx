import Link from "next/link";
import {
  startStripeRentMandate,
  refreshStripeRentMandate,
  createStripeRentSubscription,
  refreshStripeRentSubscription,
} from "@/app/dashboard/tenancies/stripe-rent-actions";
import {
  mandateStatusLabel,
  normalizeMandateStatus,
  rentMethodForCountry,
  connectCountryLabel,
  subscriptionStatusLabel,
  subscriptionIsLive,
} from "@/lib/stripe-connect";
import { StatusChip, type ChipTone } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

// The Stripe Connect rent-collection panel on a tenancy (platform pivot step 2,
// ALT provider, increment 2; S215). Sibling of the Rotessa block. Collects a
// bank-debit MANDATE from the primary tenant on the landlord's connected
// account via a hosted Checkout setup session. Increment 3 will add the monthly
// subscription off the saved payment method.

export type TenancyStripeRentView = {
  tenancyId: string;
  primaryName: string | null;
  primaryHasEmail: boolean;
  country: string | null;
  connectExists: boolean; // org has started Stripe Connect onboarding
  connectReady: boolean; // connected account can actually charge
  mandateStatus: string;
  paymentMethodId: string | null;
  syncedAt: string | null;
  stripeConfigured: boolean;
  // increment 3 (monthly subscription)
  rentCents: number | null;
  rentLabel: string;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  firstChargeDefault: string;
  firstChargeMin: string;
  firstChargeHint: string;
};

function mandateTone(status: string): ChipTone {
  const s = normalizeMandateStatus(status);
  if (s === "active") return "success";
  if (s === "pending") return "warn";
  if (s === "failed") return "danger";
  return "neutral";
}

export default function TenancyStripeRentSection({ view }: { view: TenancyStripeRentView }) {
  const status = normalizeMandateStatus(view.mandateStatus);
  const method = rentMethodForCountry(view.country);

  return (
    <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-700">Stripe (bank debit)</h4>
        {status !== "none" && <StatusChip tone={mandateTone(status)}>{mandateStatusLabel(status)}</StatusChip>}
      </div>

      {!view.stripeConfigured ? (
        <p className="text-sm text-gray-600">Payments aren&apos;t configured on this deployment yet.</p>
      ) : !view.connectExists ? (
        <p className="text-sm text-gray-600">
          Set up Stripe rent collection in{" "}
          <Link href="/dashboard/settings#stripe-rent" className="font-medium text-brand hover:underline">
            Settings
          </Link>{" "}
          to collect rent by bank debit (Canada PAD or US ACH) for this tenancy.
        </p>
      ) : !view.connectReady ? (
        <p className="text-sm text-gray-600">
          Finish your Stripe onboarding in{" "}
          <Link href="/dashboard/settings#stripe-rent" className="font-medium text-brand hover:underline">
            Settings
          </Link>{" "}
          (it isn&apos;t able to collect payments yet), then come back to authorize the tenant.
        </p>
      ) : !view.primaryName || !view.primaryHasEmail ? (
        <p className="text-sm text-gray-600">
          Add a name and email to the primary tenant above first — bank mandates
          and debit notices are emailed to them.
        </p>
      ) : status === "active" ? (
        <div className="space-y-4">
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {view.primaryName} authorized {method.label.toLowerCase()}. The saved
              bank account is ready for monthly rent.
            </p>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-gray-500">Payment method</dt>
                <dd className="font-mono text-xs text-gray-700">{view.paymentMethodId ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Last checked</dt>
                <dd className="font-medium text-gray-900">
                  {view.syncedAt ? new Date(view.syncedAt).toLocaleString() : "—"}
                </dd>
              </div>
            </dl>
            {!view.subscriptionId && (
              <form action={refreshStripeRentMandate}>
                <input type="hidden" name="tenancy_id" value={view.tenancyId} />
                <SubmitButton
                  pendingLabel="Refreshing…"
                  className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Refresh authorization
                </SubmitButton>
              </form>
            )}
          </div>

          {/* Monthly rent subscription (increment 3) */}
          <div className="border-t border-gray-100 pt-4">
            {view.subscriptionId ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip tone={subscriptionIsLive(view.subscriptionStatus) ? "success" : "warn"}>
                    {subscriptionStatusLabel(view.subscriptionStatus)}
                  </StatusChip>
                  <span className="text-sm text-gray-600">
                    {view.rentLabel}/mo, billed automatically to the saved bank account.
                  </span>
                </div>
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-gray-500">Subscription ID</dt>
                    <dd className="font-mono text-xs text-gray-700">{view.subscriptionId}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Last synced</dt>
                    <dd className="font-medium text-gray-900">
                      {view.syncedAt ? new Date(view.syncedAt).toLocaleString() : "—"}
                    </dd>
                  </div>
                </dl>
                <p className="text-xs text-gray-400">
                  Bank debits can take a few business days to confirm. Manage or
                  cancel the subscription from your Stripe dashboard.
                </p>
                <form action={refreshStripeRentSubscription}>
                  <input type="hidden" name="tenancy_id" value={view.tenancyId} />
                  <SubmitButton
                    pendingLabel="Refreshing…"
                    className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Refresh status
                  </SubmitButton>
                </form>
              </div>
            ) : view.rentCents == null ? (
              <p className="text-sm text-gray-600">
                Set a monthly rent amount in Lease details below, then you can
                schedule automatic rent collection.
              </p>
            ) : (
              <form action={createStripeRentSubscription} className="space-y-3">
                <input type="hidden" name="tenancy_id" value={view.tenancyId} />
                <p className="text-sm text-gray-600">
                  Schedule automatic monthly rent of{" "}
                  <span className="font-medium text-gray-900">{view.rentLabel}</span> starting on
                  your chosen date, billed to {view.primaryName}&apos;s authorized bank account.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">First charge date</label>
                    <input
                      type="date"
                      name="first_charge_date"
                      required
                      min={view.firstChargeMin}
                      defaultValue={view.firstChargeDefault}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <span className="mt-1 block text-xs text-gray-400">
                      At least 2 business days out (e.g. {view.firstChargeHint}).
                    </span>
                  </div>
                  <SubmitButton
                    pendingLabel="Setting up…"
                    className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ background: "var(--brand-gradient, var(--brand-color))" }}
                  >
                    Set up monthly rent
                  </SubmitButton>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : status === "pending" ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Authorization started for <span className="font-medium text-gray-900">{view.primaryName}</span> ({connectCountryLabel(view.country)} · {method.label}).
            Send them the authorization link (open it again below to copy from the
            address bar), then <strong>Refresh status</strong> once they finish.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <form action={startStripeRentMandate}>
              <input type="hidden" name="tenancy_id" value={view.tenancyId} />
              <SubmitButton
                pendingLabel="Opening…"
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Open authorization link
              </SubmitButton>
            </form>
            <form action={refreshStripeRentMandate}>
              <input type="hidden" name="tenancy_id" value={view.tenancyId} />
              <SubmitButton
                pendingLabel="Refreshing…"
                className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: "var(--brand-gradient, var(--brand-color))" }}
              >
                Refresh status
              </SubmitButton>
            </form>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Authorize <span className="font-medium text-gray-900">{view.primaryName}</span>&apos;s
            bank account for rent by {method.label.toLowerCase()} ({connectCountryLabel(view.country)}).
            They complete a secure Stripe page; we never see their bank numbers.
            {status === "failed" && " The previous attempt didn't complete — you can start a new one."}
          </p>
          <form action={startStripeRentMandate}>
            <input type="hidden" name="tenancy_id" value={view.tenancyId} />
            <SubmitButton
              pendingLabel="Starting…"
              className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: "var(--brand-gradient, var(--brand-color))" }}
            >
              Start bank authorization
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}

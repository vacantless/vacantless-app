import Link from "next/link";
import {
  startStripeRentMandate,
  refreshStripeRentMandate,
  createStripeRentSubscription,
  refreshStripeRentSubscription,
  stopStripeRentSubscription,
  scheduleStripeRentStop,
  cancelScheduledStripeRentStop,
} from "@/app/dashboard/tenancies/stripe-rent-actions";
import {
  mandateStatusLabel,
  normalizeMandateStatus,
  rentMethodForCountry,
  connectCountryLabel,
  subscriptionStatusLabel,
  subscriptionIsLive,
} from "@/lib/stripe-connect";
import { StatusChip, PRIMARY_ACTION_CLASS, type ChipTone } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { CopyLinkButton } from "@/components/copy-link-button";

// The Stripe Connect rent-collection panel on a tenancy (platform pivot step 2,
// ALT provider, increment 2; S215). Sibling of the Rotessa block. Collects a
// bank-debit MANDATE from the primary tenant on the landlord's connected
// account via a hosted Checkout setup session. Increment 3 will add the monthly
// subscription off the saved payment method.

export type TenancyStripeRentView = {
  // S835b: the bank link waiting on the tenant (null when none can be used).
  bankLinkUrl: string | null;
  bankLinkExpiresLabel: string | null;
  /** The saved link ran out before the tenant finished. */
  bankLinkGone: boolean;
  /** What Stripe bills each month right now; null when unknown. */
  billedLabel: string | null;
  /** Stripe bills a different amount than the rent saved on this page. */
  billedDiffers: boolean;
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
  // S796: read live from Stripe; null when unknown or not applicable.
  nextChargeLabel: string | null;
  lastPaymentLabel: string | null;
  lastPaymentAmountLabel: string | null;
  lastPaymentState: "paid" | "processing" | "failed" | null;
  // S796b: a stop is scheduled for after the payment on this date.
  stopAfterLabel: string | null;
  stopAfterIso: string | null;
  // S796c: upcoming payment dates the landlord can pick as the last one.
  lastPaymentOptions: { iso: string; label: string }[];
};

function lastPaymentText(view: TenancyStripeRentView): string {
  if (!view.lastPaymentLabel) return "None yet";
  const amount = view.lastPaymentAmountLabel ? `${view.lastPaymentAmountLabel} on ` : "";
  const state =
    view.lastPaymentState === "processing"
      ? " (processing at the bank)"
      : view.lastPaymentState === "failed"
        ? " (did not go through)"
        : "";
  return `${amount}${view.lastPaymentLabel}${state}`;
}

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
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Connect your own Stripe account once (no monthly fee). Then come back here and send{" "}
            {view.primaryName || "your tenant"} a link to set up the monthly bank debit.
          </p>
          <Link
            href={`/dashboard/settings?tab=banking&back=${encodeURIComponent(`/dashboard/tenancies/${view.tenancyId}`)}#stripe-rent`}
            className={PRIMARY_ACTION_CLASS}
            style={{ background: "var(--brand-gradient, var(--brand-color))" }}
          >
            Connect Stripe
          </Link>
        </div>
      ) : !view.connectReady ? (
        <p className="text-sm text-gray-600">
          Finish your Stripe onboarding in{" "}
          <Link
            href={`/dashboard/settings?tab=banking&back=${encodeURIComponent(`/dashboard/tenancies/${view.tenancyId}`)}#stripe-rent`}
            className="font-medium text-brand hover:underline"
          >
            Settings
          </Link>{" "}
          (it isn&apos;t able to collect payments yet), then come back to authorize the tenant.
        </p>
      ) : !view.primaryName || !view.primaryHasEmail ? (
        <p className="text-sm text-gray-600">
          Add a name and email to the primary tenant above first. Bank mandates
          and debit notices are emailed to them.
        </p>
      ) : status === "active" ? (
        <div className="space-y-4">
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {view.primaryName} authorized {method.label}. The saved
              bank account is ready for monthly rent.
            </p>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-gray-500">Payment method</dt>
                <dd className="font-mono text-xs text-gray-700">{view.paymentMethodId ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Last checked</dt>
                <dd className="font-medium text-gray-900">
                  {view.syncedAt ? new Date(view.syncedAt).toLocaleString() : "-"}
                </dd>
              </div>
            </dl>
            {!(view.subscriptionId && subscriptionIsLive(view.subscriptionStatus)) && (
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
            {/* S816h: an authorization made before S816h can't pay monthly rent;
                a fresh one can. Offered whenever no rent is running. */}
            {!(view.subscriptionId && subscriptionIsLive(view.subscriptionStatus)) && (
              <form action={startStripeRentMandate} className="mt-2">
                <input type="hidden" name="tenancy_id" value={view.tenancyId} />
                <SubmitButton
                  pendingLabel="Opening…"
                  className="text-sm font-medium text-brand hover:underline disabled:opacity-60"
                >
                  Authorize the bank again
                </SubmitButton>
                <span className="ml-2 text-xs text-gray-500">
                  Needed if rent was set up before Nov 18, 2026, or the tenant changed banks.
                </span>
              </form>
            )}
          </div>

          {/* Monthly rent subscription (increment 3) */}
          <div className="border-t border-gray-100 pt-4">
            {view.subscriptionId && subscriptionIsLive(view.subscriptionStatus) ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip tone="success">{subscriptionStatusLabel(view.subscriptionStatus)}</StatusChip>
                  <span className="text-sm text-gray-600">
                    Billed automatically to the saved bank account.
                  </span>
                </div>
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-gray-500">Amount</dt>
                    <dd className="font-medium text-gray-900">{view.billedLabel ?? view.rentLabel}/mo</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Last payment</dt>
                    <dd className="font-medium text-gray-900">{lastPaymentText(view)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Next payment</dt>
                    <dd className="font-medium text-gray-900">{view.nextChargeLabel ?? "-"}</dd>
                  </div>
                </dl>
                {view.billedDiffers && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Stripe takes {view.billedLabel} a month. The rent saved below is {view.rentLabel}. Changing the
                    rent below does not change the bank debit. To take a new amount, stop monthly rent and set it up
                    again.
                  </p>
                )}
                <p className="text-xs text-gray-400">
                  Bank debits take a few business days to confirm. Subscription{" "}
                  <span className="font-mono">{view.subscriptionId}</span>.
                </p>
                {view.stopAfterLabel && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Last payment: {view.stopAfterLabel}. Rent stops on its own once that payment goes through.
                  </p>
                )}
                <div className="flex flex-wrap items-start gap-3">
                  <form action={refreshStripeRentSubscription}>
                    <input type="hidden" name="tenancy_id" value={view.tenancyId} />
                    <SubmitButton
                      pendingLabel="Refreshing…"
                      className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Refresh status
                    </SubmitButton>
                  </form>
                  {view.stopAfterLabel && (
                    <form action={cancelScheduledStripeRentStop}>
                      <input type="hidden" name="tenancy_id" value={view.tenancyId} />
                      <SubmitButton
                        pendingLabel="Saving…"
                        className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Keep collecting instead
                      </SubmitButton>
                    </form>
                  )}
                  <details className="text-sm">
                    <summary className="inline-flex cursor-pointer select-none list-none items-center rounded-lg border border-red-200 bg-white px-4 py-2 font-semibold text-red-600 transition hover:bg-red-50 [&::-webkit-details-marker]:hidden">
                      {view.stopAfterLabel ? "Change or stop now" : "Stop monthly rent"}
                    </summary>
                    <div className="mt-2 space-y-3 rounded-lg border border-red-100 bg-red-50 p-3">
                      {view.lastPaymentOptions.length > 0 && (
                        <form action={scheduleStripeRentStop} className="space-y-2">
                          <input type="hidden" name="tenancy_id" value={view.tenancyId} />
                          <label
                            htmlFor="stripe-rent-last-payment"
                            className="block text-sm text-gray-700"
                          >
                            Pick the last {view.rentLabel} payment. Rent keeps collecting
                            through it, then stops on its own once it goes through.
                          </label>
                          <div className="flex flex-wrap items-center gap-3">
                            <select
                              id="stripe-rent-last-payment"
                              name="last_payment"
                              defaultValue={
                                view.stopAfterIso && view.lastPaymentOptions.some((o) => o.iso === view.stopAfterIso)
                                  ? view.stopAfterIso
                                  : view.lastPaymentOptions[0].iso
                              }
                              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                            >
                              {view.lastPaymentOptions.map((o) => (
                                <option key={o.iso} value={o.iso}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                            <SubmitButton
                              pendingLabel="Saving…"
                              className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {view.stopAfterLabel ? "Change the last payment" : "Stop after this payment"}
                            </SubmitButton>
                          </div>
                        </form>
                      )}
                      <form action={stopStripeRentSubscription} className="space-y-2">
                        <input type="hidden" name="tenancy_id" value={view.tenancyId} />
                        <p className="text-sm text-gray-700">
                          Or stop the {view.rentLabel} monthly debit now. No more
                          payments will be pulled. A payment already processing at
                          the bank still completes. The bank authorization is kept,
                          so you can restart rent later.
                        </p>
                        <SubmitButton
                          pendingLabel="Stopping…"
                          className="inline-flex items-center justify-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Yes, stop rent now
                        </SubmitButton>
                      </form>
                    </div>
                  </details>
                </div>
              </div>
            ) : view.rentCents == null ? (
              <p className="text-sm text-gray-600">
                Set a monthly rent amount in Lease details below, then you can
                schedule automatic rent collection.
              </p>
            ) : (
              <form action={createStripeRentSubscription} className="space-y-3">
                <input type="hidden" name="tenancy_id" value={view.tenancyId} />
                {view.subscriptionId && (
                  <p className="text-sm text-gray-600">
                    <StatusChip tone="neutral">Stopped</StatusChip>{" "}
                    Monthly rent is stopped. No debits are running.
                    {view.lastPaymentLabel ? ` Last payment: ${lastPaymentText(view)}.` : ""}
                  </p>
                )}
                <p className="text-sm text-gray-600">
                  Schedule automatic monthly rent of{" "}
                  <span className="font-medium text-gray-900">{view.rentLabel}</span> starting on
                  your chosen date, billed to {view.primaryName}&apos;s authorized bank account.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label
                      htmlFor="stripe-rent-first-charge-date"
                      className="mb-1 block text-xs font-medium text-gray-600"
                    >
                      First charge date
                    </label>
                    <input
                      id="stripe-rent-first-charge-date"
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
          {view.bankLinkUrl ? (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm text-gray-700">
                Send <span className="font-medium text-gray-900">{view.primaryName}</span> this bank link. They set up
                the monthly debit on Stripe&apos;s page ({method.label}). Do not fill it in yourself.
                {view.bankLinkExpiresLabel ? ` The link works until ${view.bankLinkExpiresLabel}.` : " The link works for 24 hours."}
              </p>
              <p className="break-all font-mono text-xs text-gray-500">{view.bankLinkUrl}</p>
              <CopyLinkButton path={view.bankLinkUrl} label="Copy bank link" />
            </div>
          ) : (
            <p className="text-sm text-gray-600">
              {view.bankLinkGone
                ? `The bank link for ${view.primaryName} ran out before they finished. Make a new one and send it.`
                : `A bank link was made for ${view.primaryName}. Press the button to show it here, then send it to them.`}
            </p>
          )}
          <p className="text-sm text-gray-600">
            This page updates by itself when they finish. <strong>Refresh status</strong> checks right away.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <form action={startStripeRentMandate}>
              <input type="hidden" name="tenancy_id" value={view.tenancyId} />
              <SubmitButton
                pendingLabel="Working…"
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {view.bankLinkUrl ? "Show the link again" : view.bankLinkGone ? "Make a new bank link" : "Show the bank link"}
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
            bank account for rent by {method.label} ({connectCountryLabel(view.country)}).
            You get a link to send them. They complete a secure Stripe page; we never see their bank numbers.
            {status === "failed" && " The previous attempt didn't complete. You can start a new one."}
          </p>
          <form action={startStripeRentMandate}>
            <input type="hidden" name="tenancy_id" value={view.tenancyId} />
            <SubmitButton
              pendingLabel="Starting…"
              className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: "var(--brand-gradient, var(--brand-color))" }}
            >
              Make the bank link
            </SubmitButton>
          </form>
        </div>
      )}

      {view.stripeConfigured && view.connectExists && (
        <p className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-400">
          Stripe charges its standard per-payment processing fee (bank debit /
          PAD is its lowest-cost method); the fee is set and deducted by Stripe.
          Vacantless adds no fee of its own.
        </p>
      )}
    </div>
  );
}

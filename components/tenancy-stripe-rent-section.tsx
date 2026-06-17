import Link from "next/link";
import {
  startStripeRentMandate,
  refreshStripeRentMandate,
} from "@/app/dashboard/tenancies/stripe-rent-actions";
import {
  mandateStatusLabel,
  normalizeMandateStatus,
  rentMethodForCountry,
  connectCountryLabel,
} from "@/lib/stripe-connect";
import { StatusChip, type ChipTone } from "@/components/ui";

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
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            {view.primaryName} authorized {method.label.toLowerCase()}. The saved
            bank account is ready for monthly rent (coming in the next step).
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
          <form action={refreshStripeRentMandate}>
            <input type="hidden" name="tenancy_id" value={view.tenancyId} />
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Refresh status
            </button>
          </form>
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
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Open authorization link
              </button>
            </form>
            <form action={refreshStripeRentMandate}>
              <input type="hidden" name="tenancy_id" value={view.tenancyId} />
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                style={{ background: "var(--brand-gradient, var(--brand-color))" }}
              >
                Refresh status
              </button>
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
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
              style={{ background: "var(--brand-gradient, var(--brand-color))" }}
            >
              Start bank authorization
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

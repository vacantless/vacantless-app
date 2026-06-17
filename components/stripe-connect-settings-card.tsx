import {
  startStripeConnect,
  refreshStripeConnect,
  disconnectStripeConnect,
} from "@/app/dashboard/settings/stripe-connect-actions";
import {
  capabilityStatusLabel,
  connectCountryLabel,
  onboardingStateLabel,
  type ConnectCapabilityStatus,
  type OnboardingState,
} from "@/lib/stripe-connect";
import {
  Card,
  IconTile,
  StatusChip,
  PRIMARY_ACTION_CLASS,
  SECONDARY_ACTION_CLASS,
  type ChipTone,
} from "@/components/ui";
import { Icons } from "@/components/icons";

// The Stripe Connect rent-collection panel on Settings (platform pivot step 2,
// ALT provider; S215). Sibling of RotessaSettingsCard. Lets a landlord onboard
// their OWN Stripe account (Express + Direct charges) to collect rent by
// Canada PAD and/or US ACH. We store only the connected account id + a cached
// status; we never hold funds or see bank numbers.
//
// Server component: status is read on the server; all mutations go through the
// guarded server actions via plain forms (no client JS needed).

export type StripeConnectAccountView = {
  connected: boolean;
  country: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  acss_status: string;
  ach_status: string;
  onboarding_state: string;
  last_synced_at: string | null;
  last_error: string | null;
};

function onboardingTone(state: OnboardingState | string): ChipTone {
  if (state === "ready") return "success";
  if (state === "incomplete") return "warn";
  return "neutral";
}

function capabilityTone(status: ConnectCapabilityStatus | string): ChipTone {
  if (status === "active") return "success";
  if (status === "pending") return "warn";
  return "neutral";
}

export default function StripeConnectSettingsCard({
  account,
  stripeConfigured,
}: {
  account: StripeConnectAccountView | null;
  stripeConfigured: boolean;
}) {
  const connected = account?.connected ?? false;
  const state = (account?.onboarding_state ?? "not_started") as OnboardingState;

  return (
    <Card className="mt-6">
      <div id="stripe-rent" className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <IconTile size="sm">
            <Icons.card className="h-4 w-4" />
          </IconTile>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
            Rent collection (Stripe)
          </h3>
        </div>
        {connected && <StatusChip tone={onboardingTone(state)}>{onboardingStateLabel(state)}</StatusChip>}
      </div>

      <p className="text-sm text-gray-600">
        Collect rent by bank debit through your own Stripe account: Canada
        pre-authorized debit (PAD) and US ACH. You are the merchant of record and
        funds settle directly to you. Vacantless schedules and tracks payments
        and never holds your money or stores bank account numbers.
      </p>

      {!stripeConfigured && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Payments aren&apos;t configured on this deployment yet
          (STRIPE_SECRET_KEY). Rent collection by Stripe can be set up once it&apos;s set.
        </div>
      )}

      {connected ? (
        <div className="mt-4 space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-gray-500">Country</dt>
              <dd className="font-medium text-gray-900">{connectCountryLabel(account?.country)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Canada PAD</dt>
              <dd>
                <StatusChip tone={capabilityTone(account?.acss_status ?? "")}>
                  {capabilityStatusLabel(account?.acss_status)}
                </StatusChip>
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">US ACH</dt>
              <dd>
                <StatusChip tone={capabilityTone(account?.ach_status ?? "")}>
                  {capabilityStatusLabel(account?.ach_status)}
                </StatusChip>
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Last synced</dt>
              <dd className="font-medium text-gray-900">
                {account?.last_synced_at ? new Date(account.last_synced_at).toLocaleString() : "—"}
              </dd>
            </div>
          </dl>

          {state !== "ready" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Stripe onboarding isn&apos;t finished yet. Click <strong>Finish setup</strong> to
              complete it, then <strong>Refresh status</strong>.
            </div>
          )}

          {account?.last_error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {account.last_error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {state !== "ready" && (
              <form action={startStripeConnect}>
                <button
                  type="submit"
                  disabled={!stripeConfigured}
                  className={`${PRIMARY_ACTION_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
                  style={{ background: "var(--brand-gradient, var(--brand-color))" }}
                >
                  Finish setup
                </button>
              </form>
            )}
            <form action={refreshStripeConnect}>
              <button type="submit" className={SECONDARY_ACTION_CLASS}>
                Refresh status
              </button>
            </form>
            <form action={disconnectStripeConnect}>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50"
              >
                Disconnect
              </button>
            </form>
          </div>
        </div>
      ) : (
        <form action={startStripeConnect} className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Country</span>
            <select
              name="country"
              defaultValue="CA"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm sm:w-64"
            >
              <option value="CA">Canada (PAD)</option>
              <option value="US">United States (ACH)</option>
            </select>
            <span className="mt-1 block text-xs text-gray-400">
              Where your Stripe account is based. This sets the rent currency
              (CAD for Canada, USD for the US).
            </span>
          </label>
          <button
            type="submit"
            disabled={!stripeConfigured}
            className={`${PRIMARY_ACTION_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
            style={{ background: "var(--brand-gradient, var(--brand-color))" }}
          >
            Set up rent collection with Stripe
          </button>
        </form>
      )}
    </Card>
  );
}

import { getCurrentOrg } from "@/lib/org";
import {
  PLANS,
  PAID_PLAN_KEYS,
  PILOT,
  formatPlanPrice,
  formatAmount,
  buildBillingView,
} from "@/lib/billing";
import { isBillingConfigured, isDepositConfigured } from "@/lib/stripe";
import {
  startCheckout,
  openBillingPortal,
  startPilot,
  startDepositCheckout,
} from "./actions";
import { BrandBanner } from "@/components/ui";
import { Icons } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: {
    checkout?: string;
    error?: string;
    pilot?: string;
    deposit?: string;
  };
}) {
  const org = await getCurrentOrg();
  if (!org) return null;

  const view = buildBillingView({
    plan: org.plan,
    subscription_status: org.subscription_status,
    stripe_subscription_id: org.stripe_subscription_id,
    current_period_end: org.current_period_end,
    // Without this, a Pilot org's pilot window can't be derived, so the page
    // wrongly falls through to the "free trial" copy (live QA finding S192).
    pilot_started_at: org.pilot_started_at,
    // Deposit state must be threaded in or buildBillingView defaults it to
    // "none" and the panel always shows "Pay deposit" even after it's paid
    // (live QA finding S202: deposit recorded in the DB but never reflected).
    pilot_deposit_status: org.pilot_deposit_status,
    pilot_deposit_amount_cents: org.pilot_deposit_amount_cents,
    pilot_deposit_paid_at: org.pilot_deposit_paid_at,
    timezone: org.booking_timezone,
  });

  const configured = isBillingConfigured();
  const depositConfigured = isDepositConfigured();
  const checkout = searchParams.checkout;
  const error = searchParams.error;
  const pilot = searchParams.pilot;
  const deposit = searchParams.deposit;

  const errorCopy: Record<string, string> = {
    not_configured:
      "Billing isn't connected yet. Add your Stripe keys in Vercel to enable subscriptions.",
    plan: "That plan isn't recognized. Please pick Core or Plus.",
    checkout: "Couldn't start checkout. Please try again.",
    portal:
      "No billing account yet. Subscribe to a plan first, then you can manage it here.",
    already_paid:
      "You're already on a paid plan, so there's no need to start a pilot.",
    pilot: "Couldn't start your pilot. Please try again.",
    deposit: "Couldn't start the deposit payment. Please try again.",
    deposit_not_pilot:
      "The setup deposit is part of the pilot. Start your pilot first.",
  };

  // Whether to show the standalone pilot offer (only for a fresh trial org that
  // hasn't started a pilot or subscribed).
  const showPilotOffer = !view.isPaid && !view.isPilot;

  return (
    <div>
      <BrandBanner
        icon={<Icons.card />}
        eyebrow="Account"
        title="Billing"
        subtitle="Your plan. Billed monthly - change or cancel anytime, no contract."
      />

      {checkout === "success" && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Thanks! Your subscription is being activated. It can take a few seconds
          to reflect here. Refresh if it still shows your old plan.
        </div>
      )}
      {checkout === "cancel" && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          Checkout was canceled. No charge was made.
        </div>
      )}
      {pilot === "started" && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Your 30-day pilot has started. You have full access to every feature.
          You can pay your refundable ${PILOT.depositCents / 100} setup deposit
          below whenever you&apos;re ready.
        </div>
      )}
      {deposit === "success" && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Thanks! Your refundable setup deposit is being processed. It can take a
          few seconds to show as paid here. Refresh if it still shows as unpaid.
        </div>
      )}
      {deposit === "cancel" && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          Deposit payment was canceled. No charge was made.
        </div>
      )}
      {deposit === "already" && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          Your setup deposit is already paid. Nothing more to do.
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorCopy[error] ?? "Something went wrong. Please try again."}
        </div>
      )}

      {/* Current plan + status */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              Current plan
            </h3>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {view.planLabel}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {view.isPaid ? (
                <>
                  {view.statusLabel}
                  {view.periodEndLabel
                    ? ` · current period ends ${view.periodEndLabel}`
                    : ""}
                </>
              ) : view.pilotActive ? (
                <>
                  {view.pilotDaysRemaining} day
                  {view.pilotDaysRemaining === 1 ? "" : "s"} left
                  {view.pilotEndsAtLabel ? ` · ends ${view.pilotEndsAtLabel}` : ""}
                </>
              ) : view.pilotExpired ? (
                "Your 30-day pilot has ended. Choose a plan below to keep going."
              ) : (
                "You haven't started yet. Begin a 30-day pilot or choose a plan below to go live."
              )}
            </p>
          </div>
          {view.hasSubscription && configured && (
            <form action={openBillingPortal}>
              <button className="whitespace-nowrap rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Manage billing
              </button>
            </form>
          )}
        </div>

        {view.needsAttention && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            There's a problem with your subscription payment ({view.statusLabel}
            ). Open <strong>Manage billing</strong> to update your card and keep
            your account active.
          </div>
        )}
      </div>

      {!configured && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Billing isn't connected yet. Once your Stripe keys are set in Vercel,
          the subscribe buttons below go live, with no other change needed.
        </div>
      )}

      {/* Pilot offer — only for a fresh trial org */}
      {showPilotOffer && (
        <div className="mt-6 overflow-hidden rounded-2xl border-2 border-brand bg-white shadow-sm">
          <div className="border-b border-gray-100 bg-gray-50 px-6 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-brand">
              Recommended to start
            </span>
          </div>
          <div className="p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-bold text-gray-900">
                {PILOT.name} · 30 days
              </h3>
              <p className="text-right">
                <span className="text-xl font-bold text-gray-900">
                  $0<span className="text-sm font-medium text-gray-500">/month</span>
                </span>
                <span className="ml-2 text-sm text-gray-500">
                  + {formatAmount(PILOT.depositCents)} refundable deposit
                </span>
              </p>
            </div>
            <p className="mt-1 text-sm text-gray-500">{PILOT.blurb}</p>
            <ul className="mt-4 grid grid-cols-1 gap-2 text-sm text-gray-700 sm:grid-cols-2">
              {PILOT.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span className="mt-0.5 text-brand">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <form action={startPilot}>
                <button className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white sm:w-auto sm:px-8">
                  Start my 30-day pilot
                </button>
              </form>
              <p className="mt-2 text-xs text-gray-400">
                Starts instantly with full access, no card needed. You can pay the
                refundable {formatAmount(PILOT.depositCents)} deposit afterward
                (returned at the end of the pilot), and we&apos;ll help you get set
                up.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Active-pilot status panel */}
      {view.pilotActive && (
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                Your pilot is active
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {view.pilotDaysRemaining} day
                {view.pilotDaysRemaining === 1 ? "" : "s"} left
                {view.pilotEndsAtLabel ? ` · ends ${view.pilotEndsAtLabel}` : ""}.
                You have full access to every feature. Choose a plan below
                whenever you&apos;re ready to continue after the pilot.
              </p>
            </div>
            <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
              Pilot
            </span>
          </div>

          {/* Refundable setup deposit */}
          <div className="mt-5 border-t border-gray-100 pt-5">
            {view.depositPaid ? (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    Setup deposit paid
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    {view.depositAmountLabel} received
                    {view.depositPaidAtLabel ? ` on ${view.depositPaidAtLabel}` : ""}.
                    It&apos;s fully refundable and returned at the end of your
                    pilot.
                  </p>
                </div>
                <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
                  Paid
                </span>
              </div>
            ) : view.depositRefunded ? (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    Setup deposit refunded
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    Your {view.depositAmountLabel} deposit has been returned.
                  </p>
                </div>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                  Refunded
                </span>
              </div>
            ) : view.showDepositCta ? (
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  Pay your refundable {view.depositAmountLabel} setup deposit
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  A one-time, fully refundable deposit, returned at the end of
                  your pilot. Paid securely through Stripe; we never see your card
                  details.
                </p>
                <form action={startDepositCheckout} className="mt-4">
                  <button
                    disabled={!depositConfigured}
                    className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-8"
                  >
                    Pay {view.depositAmountLabel} deposit
                  </button>
                </form>
                {!depositConfigured && (
                  <p className="mt-2 text-xs text-amber-700">
                    Online deposit payment isn&apos;t connected yet. We&apos;ll
                    send you a secure payment link instead.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Plan options */}
      <h3 className="mt-8 text-sm font-semibold uppercase tracking-wider text-gray-500">
        {view.pilotActive
          ? "Continue after your pilot"
          : view.pilotExpired
            ? "Choose a plan to keep going"
            : "Founding plans"}
      </h3>
      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {PAID_PLAN_KEYS.map((key) => {
          const plan = PLANS[key];
          const isCurrent = view.planKey === key && view.isPaid;
          return (
            <div
              key={key}
              className="flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
                <p className="text-right">
                  <span className="mr-1.5 text-sm font-medium text-gray-400 line-through">
                    {formatPlanPrice(plan.listPriceCents)}
                  </span>
                  <span className="text-xl font-bold text-gray-900">
                    {formatPlanPrice(plan.priceCents)}
                  </span>
                </p>
              </div>
              <p className="mt-0.5 text-right text-[11px] font-semibold uppercase tracking-wide text-brand">
                Founding rate · locked for 12 months
              </p>
              <p className="mt-1 text-sm text-gray-500">{plan.blurb}</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-gray-700">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 text-brand">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                {isCurrent ? (
                  <div className="rounded-lg bg-gray-100 px-4 py-2 text-center text-sm font-medium text-gray-500">
                    Current plan
                  </div>
                ) : (
                  <form action={startCheckout}>
                    <input type="hidden" name="plan" value={key} />
                    <button
                      disabled={!configured}
                      className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {view.isPaid
                        ? `Switch to ${plan.name}`
                        : view.isPilot
                          ? `Continue on ${plan.name}`
                          : `Subscribe to ${plan.name}`}
                    </button>
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500">
        <p>
          <span className="font-medium text-gray-700">
            Founding pricing is locked for 12 months
          </span>{" "}
          after your pilot starts, then moves to the then-current standard rate
          with at least 60 days&apos; notice.
        </p>
        <p className="mt-1.5">
          Billed monthly. Cancel anytime from the billing portal, with no
          contract and no cancellation fee.
        </p>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Payments are processed by Stripe; Vacantless never sees your card
        details. Prices are in CAD.
      </p>
    </div>
  );
}

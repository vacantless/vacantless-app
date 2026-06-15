import { getCurrentOrg } from "@/lib/org";
import {
  PLANS,
  PAID_PLAN_KEYS,
  formatPlanPrice,
  buildBillingView,
} from "@/lib/billing";
import { isBillingConfigured } from "@/lib/stripe";
import { startCheckout, openBillingPortal } from "./actions";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: { checkout?: string; error?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) return null;

  const view = buildBillingView({
    plan: org.plan,
    subscription_status: org.subscription_status,
    stripe_subscription_id: org.stripe_subscription_id,
    current_period_end: org.current_period_end,
    timezone: org.booking_timezone,
  });

  const configured = isBillingConfigured();
  const checkout = searchParams.checkout;
  const error = searchParams.error;

  const errorCopy: Record<string, string> = {
    not_configured:
      "Billing isn't connected yet. Add your Stripe keys in Vercel to enable subscriptions.",
    plan: "That plan isn't recognized. Please pick Core or Plus.",
    checkout: "Couldn't start checkout. Please try again.",
    portal:
      "No billing account yet — subscribe to a plan first, then you can manage it here.",
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900">Billing</h2>
      <p className="mt-1 text-sm text-gray-500">
        Your Vacantless subscription. Plans are billed monthly; you can change
        or cancel anytime from the billing portal.
      </p>

      {checkout === "success" && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Thanks! Your subscription is being activated. It can take a few seconds
          to reflect here — refresh if it still shows your old plan.
        </div>
      )}
      {checkout === "cancel" && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          Checkout was canceled. No charge was made.
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorCopy[error] ?? "Something went wrong. Please try again."}
        </div>
      )}

      {/* Current plan + status */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
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
              ) : (
                "You're on the free trial. Choose a plan below to go live."
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
          the subscribe buttons below go live — no other change needed.
        </div>
      )}

      {/* Plan options */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {PAID_PLAN_KEYS.map((key) => {
          const plan = PLANS[key];
          const isCurrent = view.planKey === key && view.isPaid;
          return (
            <div
              key={key}
              className="flex flex-col rounded-xl border border-gray-200 bg-white p-6"
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
                Founding rate · locked while active
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
                      {view.isPaid ? `Switch to ${plan.name}` : `Subscribe to ${plan.name}`}
                    </button>
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-gray-400">
        Payments are processed by Stripe; Vacantless never sees your card
        details. Prices are in CAD.
      </p>
    </div>
  );
}

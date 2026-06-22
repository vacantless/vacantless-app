import { TIERS, TIER_KEYS, formatPlanPrice, isTierPurchasable } from "@/lib/billing";

// Standalone 3-up comparison of the live Free / Growth / Premium ladder (Package
// B). The dashboard billing page renders its own purchasable cards (with
// Subscribe buttons); this component is a self-contained, non-interactive
// comparison grid suitable for a marketing / public pricing surface. It shows
// each tier's price + features and a status chip (Included / Available / Coming
// soon) derived from isTierPurchasable. Not currently mounted anywhere — kept as
// a reusable building block.
export function TierComparison() {
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          Plans
        </h3>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Usage costs (texts, ad spend, payment processing) always pass through at
        cost on top of these monthly fees.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {TIER_KEYS.map((key) => {
          const tier = TIERS[key];
          const isFree = tier.priceCents === 0;
          const purchasable = isTierPurchasable(tier);
          return (
            <div
              key={key}
              className={`flex flex-col rounded-2xl border bg-white p-6 shadow-sm ${
                tier.highlight ? "border-brand ring-1 ring-brand" : "border-gray-200"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-lg font-bold text-gray-900">{tier.name}</h4>
                {tier.highlight && (
                  <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand">
                    Most popular
                  </span>
                )}
              </div>
              <p className="mt-1">
                <span className="text-2xl font-bold text-gray-900">
                  {formatPlanPrice(tier.priceCents)}
                </span>
              </p>
              <p className="mt-1 text-sm text-gray-500">{tier.blurb}</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-gray-700">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 text-brand">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <div className="rounded-lg bg-gray-100 px-4 py-2 text-center text-sm font-medium text-gray-500">
                  {isFree ? "Included" : purchasable ? "Available" : "Coming soon"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

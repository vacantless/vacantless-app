import React from "react";
import { formatMoney } from "@/lib/price-drop";
import type { RentIncreaseMarketContext } from "@/lib/rent-increase-market";

// Display-only market context for the tenancy Rent-increase section (S545).
// Shows the market range for this unit next to the guideline-capped renewal
// rent, plus a plain-language read of where the capped rent sits vs market.
// Renders nothing when there is no context (gated off, or no benchmark for the
// unit) so the section degrades to exactly today's guideline-only view.
export function RentIncreaseMarketNote({
  context,
}: {
  context: RentIncreaseMarketContext | null;
}) {
  if (!context) return null;

  const { confidence, position } = context;
  const confidenceClass =
    confidence === "high"
      ? "bg-green-50 text-green-700"
      : confidence === "medium"
        ? "bg-amber-50 text-amber-700"
        : "bg-gray-100 text-gray-600";

  // Tone the position line: a below-market cap is the actionable insight
  // (money on the table at turnover), at/above is reassurance.
  const positionClass =
    position === "below"
      ? "text-amber-800"
      : position === "above"
        ? "text-gray-600"
        : "text-emerald-700";

  return (
    <section className="mb-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">
            Market rent for this unit
          </h4>
          <p className="text-xs text-gray-500">
            How the guideline-capped renewal rent compares to the open market.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${confidenceClass}`}
        >
          {confidence} confidence
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Market range
          </p>
          <p className="mt-1 text-base font-semibold text-gray-900">
            {formatMoney(context.marketLowCents)} - {formatMoney(context.marketHighCents)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Market midpoint
          </p>
          <p className="mt-1 text-base font-semibold text-gray-900">
            {formatMoney(context.marketMidCents)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
            {context.comparedIsNewRent ? "Capped renewal rent" : "Current rent"}
          </p>
          <p className="mt-1 text-base font-semibold text-gray-900">
            {formatMoney(context.comparedRentCents)}
          </p>
        </div>
      </div>

      <p className={`mt-3 text-xs leading-relaxed ${positionClass}`}>
        {context.note}
      </p>
      <p className="mt-2 text-xs text-gray-400">
        Guidance only. It does not change the N1 amount you serve, which stays the
        guideline-capped figure.
      </p>
    </section>
  );
}

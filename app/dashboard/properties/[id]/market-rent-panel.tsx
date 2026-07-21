import React from "react";
import { formatMoney } from "@/lib/price-drop";
import type { MarketRentSuggestion } from "@/lib/market-rent";

export function MarketRentPanel({
  suggestion,
  city,
  className = "",
}: {
  suggestion: MarketRentSuggestion | null;
  city: string | null;
  className?: string;
}) {
  const confidence = suggestion?.confidence ?? "low";
  const confidenceClass =
    confidence === "high"
      ? "bg-green-50 text-green-700"
      : confidence === "medium"
        ? "bg-amber-50 text-amber-700"
        : "bg-gray-100 text-gray-600";

  return (
    <section
      className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm ${className}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white shadow-sm ring-1 ring-black/5"
            style={{ background: "var(--brand-gradient, var(--brand-color))" }}
          >
            $
          </span>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Suggested market rent
            </h3>
            <p className="text-xs text-gray-500">
              {city ? `${city} benchmark and your own leasing history` : "Benchmark and leasing history"}
            </p>
          </div>
        </div>
        {suggestion && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${confidenceClass}`}
          >
            {confidence} confidence
          </span>
        )}
      </div>

      {suggestion ? (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                Range
              </p>
              <p className="mt-1 text-lg font-semibold text-gray-900">
                {formatMoney(suggestion.lowCents)} - {formatMoney(suggestion.highCents)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                Midpoint
              </p>
              <p className="mt-1 text-lg font-semibold text-gray-900">
                {formatMoney(suggestion.midCents)}
              </p>
            </div>
          </div>
          <div className="mt-4 border-t border-gray-100 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Basis
            </p>
            <ul className="space-y-1.5">
              {suggestion.basis.map((line) => (
                <li key={line} className="flex items-start gap-2 text-xs text-gray-600">
                  <span aria-hidden className="mt-px text-brand">
                    *
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Suggestion only. Saving the rent is always an operator action.
          </p>
        </>
      ) : (
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <p className="text-sm font-medium text-gray-800">
            Not enough local data yet — this sharpens as you lease units.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            Add local benchmark rows or let Vacantless capture leased outcomes
            before showing a rent range.
          </p>
        </div>
      )}
    </section>
  );
}

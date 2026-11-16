// S807: replaces the "Suggested market rent" panel (market-rent-panel.tsx).
// Reads this rental's own renters and viewings; see lib/demand-check.ts.
import type { DemandCheck } from "@/lib/demand-check";

const TONE_CLASS: Record<DemandCheck["tone"], string> = {
  early: "bg-gray-100 text-gray-600",
  quiet: "bg-amber-50 text-amber-800",
  not_booking: "bg-amber-50 text-amber-800",
  strong: "bg-green-50 text-green-700",
  steady: "bg-green-50 text-green-700",
};

export function DemandCheckPanel({ check }: { check: DemandCheck }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">How this rental is doing</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[check.tone]}`}>{check.headline}</span>
      </div>
      <p className="mt-2 text-sm text-gray-700">{check.advice}</p>
      <p className="mt-1 text-xs text-gray-500">{check.facts}. From this rental&apos;s own renters, not area averages.</p>
    </section>
  );
}

// S734: "Where your renters come from" on the rental's Post section.
import type { RenterSources } from "@/lib/renter-sources";

export function RenterSourcesCard({ sources }: { sources: RenterSources }) {
  if (sources.total === 0) return null;
  const max = Math.max(...sources.rows.map((r) => r.enquiries), 1);
  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">Where your renters come from</p>
        <p className="text-xs text-gray-500">
          {sources.total} {sources.total === 1 ? "inquiry" : "inquiries"} for this rental
        </p>
      </div>
      <ul className="mt-3 space-y-2">
        {sources.rows.map((row) => (
          <li key={row.site} className="text-xs text-gray-700">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-gray-900">{row.site}</span>
              <span className="tabular-nums text-gray-600">
                {row.enquiries} {row.enquiries === 1 ? "renter" : "renters"}
                {row.booked > 0 ? ` · ${row.booked} booked` : ""}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100">
              <div
                className="h-1.5 rounded-full bg-brand"
                style={{ width: `${Math.max(4, Math.round((row.enquiries / max) * 100))}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      {sources.advice && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-xs ${
            sources.advice.tone === "good"
              ? "bg-green-50 text-green-800"
              : sources.advice.tone === "fix"
                ? "bg-amber-50 text-amber-800"
                : "bg-indigo-50 text-indigo-800"
          }`}
        >
          {sources.advice.text}
        </p>
      )}
    </div>
  );
}

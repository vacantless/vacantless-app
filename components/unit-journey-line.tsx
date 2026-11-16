// S807: the one progress line for a rental (lib/unit-journey). Display only:
// nothing here ticks a step; every state comes from a recorded fact.
import type { Journey } from "@/lib/unit-journey";

export function UnitJourneyLine({ journey, compact = false }: { journey: Journey; compact?: boolean }) {
  if (compact) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]" aria-label="Where this rental is">
        {journey.steps.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="text-gray-300">›</span>}
            <span
              className={
                s.state === "done"
                  ? "text-gray-400"
                  : s.state === "current"
                    ? "rounded-full bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800"
                    : "text-gray-300"
              }
            >
              {s.label}
            </span>
          </span>
        ))}
      </div>
    );
  }
  return (
    <section className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm" aria-label="Where this rental is">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
        {journey.steps.map((s, i) => (
          <li key={s.key} className="inline-flex items-center gap-2">
            {i > 0 && <span aria-hidden className="text-gray-300">›</span>}
            <span
              className={
                s.state === "done"
                  ? "inline-flex items-center gap-1 text-gray-500"
                  : s.state === "current"
                    ? "rounded-full bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-800 ring-1 ring-amber-200"
                    : "text-gray-300"
              }
            >
              {s.state === "done" ? <span aria-hidden>✓</span> : null}
              {s.label}
            </span>
          </li>
        ))}
      </ol>
      {journey.next ? (
        <p className="mt-2 text-sm text-gray-800">
          <span className="font-semibold">Next:</span> {journey.next}
        </p>
      ) : (
        <p className="mt-2 text-sm text-gray-600">Tenant in place. Nothing to do here.</p>
      )}
      {journey.gap ? <p className="mt-1 text-xs text-amber-800">{journey.gap}</p> : null}
    </section>
  );
}

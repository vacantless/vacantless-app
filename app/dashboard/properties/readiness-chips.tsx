import type { ReadinessSignal, ReadinessTone } from "@/lib/rental-readiness";

// Tone -> chip styling. ok = green (ready), warn = amber (actionable gap),
// muted = gray (intentional state, e.g. a leased link or a not-live feed row).
const TONE_CLASS: Record<ReadinessTone, string> = {
  ok: "border-green-200 bg-green-50 text-green-700",
  warn: "border-amber-200 bg-amber-50 text-amber-700",
  muted: "border-gray-200 bg-gray-50 text-gray-500",
};

const DOT_CLASS: Record<ReadinessTone, string> = {
  ok: "bg-green-500",
  warn: "bg-amber-500",
  muted: "bg-gray-300",
};

/**
 * The per-rental readiness strip on the Rentals list: a compact, scannable row
 * of "Link / Photos / Viewings / Feed" chips. Each chip carries a colored dot,
 * the column label, its short value, and an explanatory tooltip + aria-label so
 * the state is legible to a sighted operator AND a screen reader.
 */
export function ReadinessChips({ signals }: { signals: ReadinessSignal[] }) {
  return (
    <ul className="mt-2 flex flex-wrap items-center gap-1.5">
      {signals.map((s) => (
        <li key={s.key}>
          <span
            title={s.hint}
            aria-label={`${s.label}: ${s.detail}. ${s.hint}`}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[s.tone]}`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS[s.tone]}`}
            />
            <span>{s.label}</span>
            <span className="font-normal opacity-80">{s.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

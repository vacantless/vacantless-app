import { SHOWING_OUTCOMES, showingOutcomeLabel } from "@/lib/pipeline";
import { updateShowingOutcome } from "./actions";

// Outcome controls as a button group instead of a dropdown: one tap to record
// what happened, with the current outcome highlighted. Each button is its own
// tiny form so no client JS is needed. "Attended" is styled as the positive
// action; "No-show"/"Cancelled" read as the off states.
const TONE: Record<string, { active: string; idle: string }> = {
  scheduled: {
    active: "bg-gray-900 text-white border-gray-900",
    idle: "bg-white text-gray-600 border-gray-300 hover:bg-gray-50",
  },
  attended: {
    active: "bg-green-600 text-white border-green-600",
    idle: "bg-white text-green-700 border-green-300 hover:bg-green-50",
  },
  no_show: {
    active: "bg-amber-600 text-white border-amber-600",
    idle: "bg-white text-amber-700 border-amber-300 hover:bg-amber-50",
  },
  cancelled: {
    active: "bg-gray-500 text-white border-gray-500",
    idle: "bg-white text-gray-600 border-gray-300 hover:bg-gray-50",
  },
};

export function OutcomeSelect({
  showingId,
  outcome,
}: {
  showingId: string;
  outcome: string;
}) {
  return (
    <div
      className="inline-flex flex-wrap gap-1.5"
      role="group"
      aria-label="Showing outcome"
    >
      {SHOWING_OUTCOMES.map((o) => {
        const active = o === outcome;
        const tone = TONE[o] ?? TONE.scheduled;
        return (
          <form key={o} action={updateShowingOutcome}>
            <input type="hidden" name="id" value={showingId} />
            <input type="hidden" name="outcome" value={o} />
            <button
              type="submit"
              aria-pressed={active}
              disabled={active}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                active ? tone.active : tone.idle
              } ${active ? "cursor-default" : ""}`}
            >
              {showingOutcomeLabel(o)}
            </button>
          </form>
        );
      })}
    </div>
  );
}

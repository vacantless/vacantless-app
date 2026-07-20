import type { CoordinationStatus } from "@/lib/showing-agents";
import { confirmShowingByOperator, setShowingConfirmed } from "./actions";

// The confirmation affordance for an assigned viewing (Slice 2 — the "did the
// agent actually confirm?" trail). Plain forms, no client JS (like OutcomeSelect):
//   * awaiting_confirmation -> a "Mark confirmed" button.
//   * confirmed             -> a green "Confirmed" badge + a quiet "Undo".
// Any other status renders nothing (unassigned viewings have nothing to confirm;
// cancelled / done are closed). Only shown when the viewer can assign.
export function ConfirmControl({
  showingId,
  status,
}: {
  showingId: string;
  status: CoordinationStatus;
}) {
  if (status === "awaiting_confirmation") {
    return (
      <form action={confirmShowingByOperator}>
        <input type="hidden" name="id" value={showingId} />
        <button
          type="submit"
          // S528: records the confirmation only — reassure that nothing sends.
          title="Records the confirmation. No message is sent."
          className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
        >
          Mark confirmed
        </button>
      </form>
    );
  }

  if (status === "confirmed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <span className="rounded-lg border border-green-300 bg-green-50 px-2.5 py-1.5 font-medium text-green-700">
          Confirmed
        </span>
        <form action={setShowingConfirmed}>
          <input type="hidden" name="id" value={showingId} />
          <input type="hidden" name="confirmed" value="false" />
          <button type="submit" className="text-gray-400 hover:text-gray-600 hover:underline">
            Undo
          </button>
        </form>
      </span>
    );
  }

  return null;
}

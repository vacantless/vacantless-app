import { rescheduleShowing } from "./actions";

// Operator reschedule affordance for an upcoming, still-open viewing (S442). A
// no-JS <details> disclosure (matching ConfirmControl's plain-form style): tap
// "Reschedule" to reveal a datetime-local input pre-filled with the current time,
// pick a new one, Save. The value is a wall-clock time the operator means in the
// org's booking timezone; the server action converts it DST-correctly, re-arms
// the reminders/nudges, resets any confirmation, and re-notifies the renter and
// the assigned agent. Only rendered on upcoming scheduled rows for a viewer who
// can manage leads.
export function RescheduleControl({
  showingId,
  defaultLocalValue,
  minLocalValue,
}: {
  showingId: string;
  defaultLocalValue: string; // "YYYY-MM-DDTHH:mm" in the org timezone
  minLocalValue: string; // "now" in the org timezone; blocks past times in the picker
}) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer list-none text-gray-500 hover:text-brand hover:underline">
        Reschedule
      </summary>
      <form action={rescheduleShowing} className="mt-1.5 flex items-center gap-1.5">
        <input type="hidden" name="id" value={showingId} />
        <input
          type="datetime-local"
          name="scheduled_at"
          defaultValue={defaultLocalValue}
          min={minLocalValue}
          required
          className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900"
          aria-label="New viewing time"
        />
        <button
          type="submit"
          className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Save
        </button>
      </form>
    </details>
  );
}

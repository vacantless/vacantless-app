import { proposeShowingTimes } from "./actions";

export type SuggestTimeSlotOption = {
  iso: string;
  label: string;
};

export function SuggestTimeControl({
  showingId,
  slots,
}: {
  showingId: string;
  slots: SuggestTimeSlotOption[];
}) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer list-none text-gray-500 hover:text-brand hover:underline">
        Suggest a new time
      </summary>
      <div className="mt-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2 text-gray-600">
        {slots.length === 0 ? (
          <p>No open viewing times are available right now.</p>
        ) : (
          <form action={proposeShowingTimes} className="space-y-2">
            <input type="hidden" name="showing_id" value={showingId} />
            <p className="font-medium text-gray-700">Pick 1-3 options to email.</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {slots.map((slot) => (
                <label
                  key={slot.iso}
                  className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5"
                >
                  <input type="checkbox" name="slot" value={slot.iso} />
                  <span>{slot.label}</span>
                </label>
              ))}
            </div>
            <button
              type="submit"
              className="rounded-lg border border-brand/30 bg-brand/5 px-2.5 py-1.5 font-medium text-brand transition hover:bg-brand/10"
            >
              Send suggestions
            </button>
          </form>
        )}
      </div>
    </details>
  );
}

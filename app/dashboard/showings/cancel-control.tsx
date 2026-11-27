import { cancelShowingByTeamAction } from "./actions";

// S846 (KI1823): cancel a booked viewing, confirmed or not, in one step. No JS:
// tap "Cancel viewing", pick why. Each reason is its own small form so the
// renter gets the right words ("this home has been rented" or "we had to
// cancel"), never "unconfirmed".
export function CancelControl({ showingId }: { showingId: string }) {
  const btn =
    "rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 font-medium text-gray-700 transition hover:bg-gray-50";
  return (
    <details className="text-xs">
      <summary className="cursor-pointer list-none text-gray-500 hover:text-brand hover:underline">
        Cancel viewing
      </summary>
      <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
        <form action={cancelShowingByTeamAction}>
          <input type="hidden" name="id" value={showingId} />
          <input type="hidden" name="reason" value="unit_rented" />
          <button type="submit" className={btn}>
            Unit is rented
          </button>
        </form>
        <form action={cancelShowingByTeamAction}>
          <input type="hidden" name="id" value={showingId} />
          <input type="hidden" name="reason" value="other" />
          <button type="submit" className={btn}>
            Other reason
          </button>
        </form>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-gray-400">
        Emails the renter and the assigned agent, and frees the time.
      </p>
    </details>
  );
}

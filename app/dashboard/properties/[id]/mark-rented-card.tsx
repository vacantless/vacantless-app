// S845: one-tap "Mark as rented" on the rental page, with the warning first.
import { createClient } from "@/lib/supabase/server";
import { loadRentedPlan } from "@/lib/mark-rented-server";
import { markPropertyRented } from "../actions";

export async function MarkRentedCard({
  propertyId,
  organizationId,
  posts,
  crewMarked,
}: {
  propertyId: string;
  organizationId: string;
  posts: { id: string; portal: string; status: string | null; url: string | null }[];
  /** The crew already tapped a rented stage: open the warning straight away. */
  crewMarked: boolean;
}) {
  const plan = await loadRentedPlan({ supabase: createClient(), organizationId, propertyId, posts });
  return (
    <details id="mark-rented" open={crewMarked} className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold text-brand">Mark as rented</summary>
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">Before you press: this takes the rental off the market.</p>
        {plan.length === 0 ? (
          <p className="mt-1">No ads are up, so there is nothing to take down.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {plan.map((l) => (
              <li key={l.postId}>
                <span className="font-medium">{l.site}:</span> <span className={l.byUs ? "text-green-800" : ""}>{l.line}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2">Waiting renters get the rented notice, if that message is on. Booked viewings are not cancelled: release them on Viewings.</p>
        <form action={markPropertyRented} className="mt-3">
          <input type="hidden" name="id" value={propertyId} />
          <button type="submit" className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            {plan.length === 0 ? "Yes, mark it rented" : "Yes, mark it rented and take the ads down"}
          </button>
        </form>
      </div>
    </details>
  );
}

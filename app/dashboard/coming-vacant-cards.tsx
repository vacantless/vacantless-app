import Link from "next/link";
import type { ComingVacant } from "@/lib/coming-vacant";
import { relistComingVacant } from "./properties/actions";

// S770 (REVIEW-S770 section 6): one card per unit a tenant is leaving, above
// the lane on Today. One sentence, one line, one button that relists the
// rental with the move-out date and opens viewings 21 days before it. Once
// relisted the card reads "Relisted" and links to the rental.
export function ComingVacantCards({ items }: { items: ComingVacant[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-6 space-y-3">
      {items.map((cv) => (
        <div
          key={cv.tenancyId}
          role="status"
          className={`flex flex-col gap-3 rounded-xl border px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${
            cv.relisted ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"
          }`}
        >
          <div>
            <p className={`text-base font-semibold ${cv.relisted ? "text-green-900" : "text-amber-900"}`}>{cv.title}</p>
            <p className={`mt-1 text-sm ${cv.relisted ? "text-green-900" : "text-amber-900"}`}>{cv.line}</p>
          </div>
          {cv.relisted ? (
            <Link
              href={`/dashboard/properties/${encodeURIComponent(cv.propertyId)}?tab=distribute#distribute-header`}
              className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800"
            >
              See the rental →
            </Link>
          ) : (
            <form action={relistComingVacant}>
              <input type="hidden" name="property_id" value={cv.propertyId} />
              <input type="hidden" name="tenancy_id" value={cv.tenancyId} />
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-sm sm:w-auto"
              >
                Relist now →
              </button>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}

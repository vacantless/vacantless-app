import Link from "next/link";
import { postToMissingSites } from "./actions";
import { coverageLabel, shortAddress, type Coverage } from "@/lib/posting-coverage";

/**
 * S754 (review item 1): every available rental against every site the account
 * can post to today, at the top of the rentals list. A rental on every site
 * takes one line; a rental with a gap gets "Post to the missing sites" (the
 * robot sites queue at once; Marketplace opens the rental's kit).
 */
export function CoverageCard({ coverage, posted }: { coverage: Coverage; posted: string | null }) {
  if (coverage.rows.length === 0) return null;
  const gaps = coverage.rows.filter((r) => r.missing.length > 0);
  return (
    <section id="site-coverage" className={`mb-5 rounded-xl border p-4 ${gaps.length ? "border-blue-200 bg-blue-50" : "border-green-200 bg-green-50"}`}>
      <p className={`text-sm font-semibold ${gaps.length ? "text-blue-900" : "text-green-800"}`}>
        {gaps.length === 0
          ? "Every available rental is on every site you can post to."
          : gaps.length === 1
            ? "1 rental is missing from a site"
            : `${gaps.length} rentals are missing from sites`}
      </p>
      {posted && (
        <p className="mt-1 text-xs font-semibold text-green-700">
          {posted === "0" ? "Those sites need you first: a sign-in or a paid ad. Open the rental to do that." : `Queued ${posted} ad${posted === "1" ? "" : "s"}. They post as soon as they are ready. The rental's page shows each one.`}
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {coverage.rows.map((row) => (
          <li
            key={row.propertyId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/60 bg-white px-3 py-2"
          >
            <div className="min-w-0 text-sm">
              <Link href={`/dashboard/properties/${row.propertyId}#distribute-header`} className="font-medium text-gray-900 hover:underline">
                {shortAddress(row.address)}
              </Link>
              <span className="ml-2 text-xs text-gray-500">
                on {row.live.length} of {row.offered} sites
                {row.live.length ? `: ${row.live.map(coverageLabel).join(", ")}` : ""}
              </span>
              {row.missing.length > 0 && (
                <span className="ml-2 text-xs font-medium text-amber-700">
                  Missing: {row.missing.map(coverageLabel).join(", ")}
                </span>
              )}
            </div>
            {row.missing.length > 0 && (
              <div className="flex items-center gap-2">
                {row.missingRobot.length > 0 && (
                  <form action={postToMissingSites}>
                    <input type="hidden" name="property_id" value={row.propertyId} />
                    <button
                      type="submit"
                      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                    >
                      Post to the missing sites
                    </button>
                  </form>
                )}
                {row.missing.includes("facebook") && (
                  <Link
                    href={`/dashboard/properties/${row.propertyId}#distribute-header`}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Marketplace kit
                  </Link>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {coverage.signInToAdd.length > 0 && (
        <p className="mt-3 text-xs text-gray-600">
          Sign in once to add {coverage.signInToAdd.map(coverageLabel).join(" and ")}:{" "}
          <Link href="/dashboard/settings#site-accounts" className="font-medium text-brand hover:underline">
            your rental site accounts
          </Link>
          .
        </p>
      )}
    </section>
  );
}

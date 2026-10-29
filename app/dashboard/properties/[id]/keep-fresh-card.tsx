import { markAdsRenewed, setPageWeeklyPosts } from "../actions";
import type { KeepFreshRow } from "@/lib/keep-fresh";

const FACEBOOK_YOUR_LISTINGS = "https://www.facebook.com/marketplace/you/selling";

/**
 * S739 (review item 10): one "Keep it fresh" card on Get online. It replaces
 * the weekly Page posts card and the old-ads card: every live ad gets one
 * line on how it stays near the top, and a Renew button only where the
 * landlord has something to press. The id stays "renew-ads" so the emailed
 * "Renew your ads" link still lands here.
 */
export function KeepFreshCard({
  propertyId,
  rows,
  weekly,
}: {
  propertyId: string;
  rows: KeepFreshRow[];
  weekly: { on: boolean; pageName: string | null; needsLogin: boolean; flash?: string } | null;
}) {
  if (rows.length === 0 && !weekly) return null;
  const due = rows.filter((r) => r.renew).length;
  const pageRow = rows.find((r) => r.key === "facebook_feed");
  const others = rows.filter((r) => r.key !== "facebook_feed");
  return (
    <div
      id="renew-ads"
      className={`mb-4 rounded-xl border p-4 ${due > 0 ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white"}`}
    >
      <p className="text-sm font-semibold text-gray-900">
        Keep it fresh
        {due > 0 && (
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            {due === 1 ? "1 ad to renew" : `${due} ads to renew`}
          </span>
        )}
      </p>
      <p className="mt-1 text-xs text-gray-600">Old ads sink lower. Here is how each of your ads stays near the top.</p>

      <ul className="mt-3 space-y-2">
        {weekly && (
          <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
            <div className="min-w-0 text-sm text-gray-900">
              <span className="font-medium">Facebook Page</span>
              <span className="text-gray-600">
                {weekly.on
                  ? `: posted again on ${weekly.pageName ?? "your Page"} every week. It runs by itself.`
                  : `: ${pageRow ? pageRow.line.replace(/\.$/, "") + ". " : ""}Turn on weekly posts and we post it again every week.`}
              </span>
              {weekly.needsLogin && (
                <span className="block text-xs text-amber-700">Facebook stopped accepting our posts. Connect your Page again to restart them.</span>
              )}
              {weekly.flash === "on" && <span className="block text-xs text-green-700">Weekly posts are on.</span>}
              {weekly.flash === "off" && <span className="block text-xs text-gray-600">Weekly posts are off.</span>}
              {weekly.flash === "error" && <span className="block text-xs text-red-700">Something went wrong. Please try again.</span>}
            </div>
            <form action={setPageWeeklyPosts}>
              <input type="hidden" name="property_id" value={propertyId} />
              <input type="hidden" name="on" value={weekly.on ? "0" : "1"} />
              <button
                type="submit"
                className={
                  weekly.on
                    ? "rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    : "rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                }
              >
                {weekly.on ? "Turn off" : "Turn on weekly posts"}
              </button>
            </form>
          </li>
        )}
        {(weekly ? others : rows).map((r) => (
          <li
            key={r.key}
            className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 ${r.renew ? "border-amber-200" : "border-gray-200"}`}
          >
            <div className="min-w-0 text-sm text-gray-900">
              <span className="font-medium">{r.label}</span>
              <span className="text-gray-600">: {r.line}</span>
            </div>
            {r.renew && (
              <div className="flex flex-wrap items-center gap-2">
                {r.key === "facebook" ? (
                  // S740: a plain link to Your listings, where Facebook keeps Renew
                  // (inside each ad's "..." menu). It records nothing: the old form
                  // marked the ad renewed on the click, then opened the ad page,
                  // which has no Renew button (walked live 2026-10-28). The helper
                  // notes the real press; "I already renewed it" is the fallback.
                  <a
                    href={FACEBOOK_YOUR_LISTINGS}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                  >
                    Open my Marketplace ads
                  </a>
                ) : (
                <form action={markAdsRenewed}>
                  <input type="hidden" name="property_id" value={propertyId} />
                  <input type="hidden" name="portal" value={r.key} />
                  <input type="hidden" name="then" value="open" />
                  <button type="submit" className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
                    Renew on {r.label}
                  </button>
                </form>
                )}
                <form action={markAdsRenewed}>
                  <input type="hidden" name="property_id" value={propertyId} />
                  <input type="hidden" name="portal" value={r.key} />
                  <button
                    type="submit"
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    I already renewed it
                  </button>
                </form>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

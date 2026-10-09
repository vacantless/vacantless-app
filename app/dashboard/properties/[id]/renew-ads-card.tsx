import { markAdsRenewed } from "../actions";

export type RenewAdItem = {
  portal: string;
  label: string;
  days: number | null;
  liveUrl: string;
};

/**
 * S702g: the top of "Get online" names every live ad that has gone old, with
 * a link to the ad and one button to say it was renewed. The daily snapshot's
 * "Ads to refresh" link lands here, so the fix is one tap from the email.
 */
export function RenewAdsCard({
  propertyId,
  items,
}: {
  propertyId: string;
  items: RenewAdItem[];
}) {
  if (items.length === 0) return null;
  return (
    <div
      id="renew-ads"
      className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4"
    >
      <p className="text-sm font-semibold text-amber-900">
        {items.length === 1 ? "1 ad is old" : `${items.length} ads are old`}
      </p>
      <p className="mt-1 text-xs text-amber-800">
        Old ads sink lower on the site. Renew the ad there. Then tap the
        button next to it.
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li
            key={item.portal}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2"
          >
            <div className="min-w-0 text-sm text-gray-900">
              <span className="font-medium">{item.label}</span>
              {item.days != null && (
                <span className="text-gray-500">, posted {item.days} days ago</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <a
                href={item.liveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Open the ad
              </a>
              <form action={markAdsRenewed}>
                <input type="hidden" name="property_id" value={propertyId} />
                <input type="hidden" name="portal" value={item.portal} />
                <button
                  type="submit"
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                >
                  I renewed it today
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

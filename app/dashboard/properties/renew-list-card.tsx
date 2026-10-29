import { markAdsRenewed, markAllAdsRenewed } from "./actions";
import type { RenewListItem } from "@/lib/listing-health";

// Facebook lists every Marketplace ad the person posted on one page, each
// with its own Renew. Only the person can press it (no API for Marketplace).
const FACEBOOK_YOUR_LISTINGS = "https://www.facebook.com/marketplace/you/selling";

/**
 * S737: every old ad across all rentals, at the top of the rentals list. The
 * "ads need a refresh" email lands here when several rentals have old ads.
 * Same two buttons as the rental's own Renew box (renew-ads-card.tsx).
 */
export function RenewListCard({ items, renewed }: { items: RenewListItem[]; renewed: boolean }) {
  if (items.length === 0) {
    return renewed ? (
      <p id="renew-ads" className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
        All your ads are fresh. We will remind you when one gets old.
      </p>
    ) : null;
  }
  return (
    <section id="renew-ads" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-900">
        {items.length === 1 ? "1 ad to renew" : `${items.length} ads to renew`}
      </p>
      <p className="mt-1 text-xs text-amber-800">
        Old ads sink lower on the site. Renew them on the site, then tell us here.
      </p>
      {renewed && <p className="mt-1 text-xs font-semibold text-green-700">Saved. We will remind you when an ad gets old again.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {items.some((i) => i.portal === "facebook") && (
          <a
            href={FACEBOOK_YOUR_LISTINGS}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            Open all my Marketplace ads
          </a>
        )}
        {items.length > 1 && (
          <form action={markAllAdsRenewed}>
            {items.map((i) => (
              <input key={`${i.propertyId}-${i.portal}`} type="hidden" name="pair" value={`${i.propertyId}|${i.portal}`} />
            ))}
            <button
              type="submit"
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              I renewed them all
            </button>
          </form>
        )}
      </div>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li
            key={`${item.propertyId}-${item.portal}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2"
          >
            <div className="min-w-0 text-sm text-gray-900">
              <span className="font-medium">{item.address}</span>
              <span className="text-gray-500">
                , {item.label}
                {item.days != null ? `, posted ${item.days} days ago` : ""}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {item.portal === "facebook" ? (
                // S740: same fix as the rental's Keep it fresh card (S740d).
                // The form recorded the renewal on the click and opened the
                // ad page, which has no Renew; Renew lives on Your listings.
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
                <input type="hidden" name="property_id" value={item.propertyId} />
                <input type="hidden" name="portal" value={item.portal} />
                <input type="hidden" name="then" value="open" />
                <button
                  type="submit"
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                >
                  Renew on {item.label}
                </button>
              </form>
              )}
              <form action={markAdsRenewed}>
                <input type="hidden" name="property_id" value={item.propertyId} />
                <input type="hidden" name="portal" value={item.portal} />
                <input type="hidden" name="back" value="list" />
                <button
                  type="submit"
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  I already renewed it
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

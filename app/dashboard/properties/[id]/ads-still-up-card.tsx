// S723: ads that still show a rental that has left the market (lib/ads-still-up.ts).
import { siteName, type StillUpPost } from "@/lib/ads-still-up";
import { markAdTakenDown } from "./ads-still-up-actions";

export function AdsStillUpCard({
  propertyId,
  statusPhrase,
  posts,
  justMarked,
}: {
  propertyId: string;
  statusPhrase: string;
  posts: StillUpPost[];
  justMarked: boolean;
}) {
  if (posts.length === 0) {
    return justMarked ? (
      <p
        id="ads-still-up"
        className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700"
      >
        Done. No ads are left showing this rental.
      </p>
    ) : null;
  }
  return (
    <div
      id="ads-still-up"
      className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <p className="font-semibold">
        This rental {statusPhrase}, but {posts.length === 1 ? "1 ad still shows it" : `${posts.length} ads still show it`}.
      </p>
      <p className="mt-1 text-amber-800">
        We can&apos;t delete ads on your own accounts. Open each one, delete it on that site, then press
        &quot;I took it down&quot;.
      </p>
      <ul className="mt-3 space-y-2">
        {posts.map((post) => (
          <li key={post.id} className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{siteName(post.portal)}</span>
            <a
              href={post.url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="font-semibold underline"
            >
              Open the ad
            </a>
            <form action={markAdTakenDown}>
              <input type="hidden" name="property_id" value={propertyId} />
              <input type="hidden" name="post_id" value={post.id} />
              <button
                type="submit"
                className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
              >
                I took it down
              </button>
            </form>
          </li>
        ))}
      </ul>
      {posts.some((p) => p.portal === "kijiji") && (
        <p className="mt-3 text-xs text-amber-800">
          Paid for the Kijiji ad? You can leave it up until it ends. Renters who reply can see your other
          rentals.
        </p>
      )}
    </div>
  );
}

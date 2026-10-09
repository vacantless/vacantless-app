import { setPageWeeklyPosts } from "../actions";

/**
 * S702i: weekly automatic posts to the landlord's Facebook Page. Facebook lets
 * an app post to a Page the landlord connected, so this one runs with nobody
 * touching anything. It does not renew Marketplace ads; those stay on the
 * old-ads card above.
 */
export function PageWeeklyPostsCard({
  propertyId,
  accountStatus,
  pageName,
  on,
  flash,
}: {
  propertyId: string;
  accountStatus: string | null;
  pageName: string | null;
  on: boolean;
  flash?: string;
}) {
  const connected = accountStatus === "connected";
  const needsLogin = accountStatus === "needs_login";
  const connectHref = `/api/integrations/facebook/connect?propertyId=${encodeURIComponent(propertyId)}`;
  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            Weekly posts on your Facebook Page
            {connected && on && (
              <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">
                On
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {connected && on
              ? `We post each open rental to ${pageName ?? "your Page"} once a week. It runs by itself.`
              : connected
                ? `Post each open rental to ${pageName ?? "your Page"} once a week, with its booking link. It runs by itself.`
                : "Connect your business Facebook Page. We then post each open rental there once a week."}
          </p>
          {needsLogin && (
            <p className="mt-2 text-xs text-amber-700">
              Facebook stopped accepting our posts. Connect your Page again to restart them.
            </p>
          )}
          {flash === "on" && <p className="mt-2 text-xs text-green-700">Weekly posts are on.</p>}
          {flash === "off" && <p className="mt-2 text-xs text-gray-600">Weekly posts are off.</p>}
          {flash === "connect" && (
            <p className="mt-2 text-xs text-amber-700">Connect your Page first.</p>
          )}
          {flash === "error" && (
            <p className="mt-2 text-xs text-red-700">Something went wrong. Please try again.</p>
          )}
        </div>
        {connected ? (
          <form action={setPageWeeklyPosts}>
            <input type="hidden" name="property_id" value={propertyId} />
            <input type="hidden" name="on" value={on ? "0" : "1"} />
            <button
              type="submit"
              className={
                on
                  ? "rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  : "rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              }
            >
              {on ? "Turn off" : "Turn on weekly posts"}
            </button>
          </form>
        ) : (
          <a
            href={connectHref}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            Connect your Page
          </a>
        )}
      </div>
    </div>
  );
}

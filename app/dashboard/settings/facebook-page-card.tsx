import { disconnectFacebookPage } from "../properties/distribution-actions";

/**
 * S705: the Facebook Page Connect / Disconnect controls. They used to live
 * only inside the property page's "Advanced tools" channel cards; Settings is
 * where a landlord looks for an account connection, and it is the one place
 * the post-Meta deletion order keeps them.
 */
export type FacebookPageCardView = {
  pageStatus: string | null;
  pageName: string | null;
  instagramEnabled: boolean;
  instagramStatus: string | null;
  instagramLabel: string | null;
  instagramHasBusinessAccount: boolean;
};

const CONNECT_HREF = "/api/integrations/facebook/connect";

const FLASH: Record<string, { tone: "ok" | "warn" | "bad"; text: string }> = {
  connected: { tone: "ok", text: "Your Facebook Page is connected." },
  disconnected: { tone: "ok", text: "Your Facebook Page is disconnected." },
  cancelled: { tone: "warn", text: "Facebook sign-in was cancelled. Your Page stays as it was." },
  error: { tone: "bad", text: "Facebook did not connect. Please try again." },
};

const FLASH_CLASS = {
  ok: "border-green-200 bg-green-50 text-green-800",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  bad: "border-red-200 bg-red-50 text-red-800",
} as const;

export function FacebookPageCard({
  view,
  flash,
}: {
  view: FacebookPageCardView;
  flash?: string;
}) {
  const pageConnected = view.pageStatus === "connected" && Boolean(view.pageName);
  const pageNeedsLogin = view.pageStatus === "needs_login";
  const igConnected =
    view.instagramEnabled &&
    view.instagramStatus === "connected" &&
    Boolean(view.instagramLabel);
  const notice = flash ? FLASH[flash] : undefined;

  return (
    <div
      id="facebook-page"
      className="scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-5"
    >
      <h3 className="text-base font-semibold text-gray-900">Your Facebook Page</h3>
      <p className="mt-1 max-w-2xl text-sm text-gray-600">
        Connect your business Facebook Page. We can then post your open
        rentals there, each with its booking link. This is your Page, not
        Marketplace.
      </p>

      {notice && (
        <p className={`mt-3 rounded-lg border px-3 py-2 text-sm ${FLASH_CLASS[notice.tone]}`}>
          {notice.text}
        </p>
      )}

      {pageConnected ? (
        <div className="mt-4 space-y-2 text-sm">
          <p className="font-medium text-gray-800">Connected: {view.pageName}</p>
          {view.instagramEnabled &&
            (igConnected ? (
              <p className="text-gray-700">Instagram: {view.instagramLabel}</p>
            ) : view.instagramHasBusinessAccount === false ? (
              <p className="text-xs text-amber-800">
                This Page has no Instagram business account linked, so we cannot
                post to Instagram.
              </p>
            ) : null)}
          <form action={disconnectFacebookPage}>
            <button
              type="submit"
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-gray-50"
            >
              Disconnect
            </button>
          </form>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {pageNeedsLogin && (
            <p className="text-sm text-amber-800">
              Facebook stopped accepting our posts. Connect your Page again.
            </p>
          )}
          <a
            href={CONNECT_HREF}
            className="inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm"
          >
            Connect Facebook Page
          </a>
        </div>
      )}
    </div>
  );
}

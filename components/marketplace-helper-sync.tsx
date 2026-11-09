"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MARKETPLACE_HELPER_AD_LIST_MIN_VERSION,
  MARKETPLACE_HELPER_APP_SOURCE,
  MARKETPLACE_HELPER_REJECT_MIN_VERSION,
  MARKETPLACE_HELPER_RENEW_MIN_VERSION,
  rejectedAdsBanner,
  isHelperMessage,
  isHelperPong,
  versionAtLeast,
  type HelperAdEntry,
} from "@/lib/marketplace-helper";
import { MARKETPLACE_HELPER_REPLIED_MIN_VERSION } from "@/lib/chat-leads";

// S738: on any dashboard page, when the Vacantless helper (1.1.0+) answers,
// hand it the list of live Marketplace ads (for "Fill booking reply" in
// Facebook chats) and save any ad links it noted on the landlord's own new
// ads. Renders nothing. Same window, same origin only.
// S739: also saves the Facebook renewals the helper (1.2.0+) saw the landlord press.
// S764: and marks down the Marketplace ads the helper (1.2.4+) saw Facebook
// remove, with a banner that says which rental to post again.
// S767: and saves the renters the helper (1.2.5+) filled a chat reply for, as
// Replied renters with no email or phone yet (lib/chat-leads).
export function MarketplaceHelperSync({
  loadAds,
  saveCaptured,
  saveRenewed,
  saveRejected,
  saveReplied,
}: {
  loadAds: () => Promise<HelperAdEntry[]>;
  saveCaptured: (items: unknown) => Promise<{ done: string[] }>;
  saveRenewed: (items: unknown) => Promise<{ done: string[] }>;
  saveRejected: (items: unknown) => Promise<{ done: string[]; rentals: { propertyId: string; rental: string }[] }>;
  saveReplied: (items: unknown) => Promise<{ done: string[] }>;
}) {
  const router = useRouter();
  const [removed, setRemoved] = useState<{ propertyId: string; rental: string }[]>([]);
  useEffect(() => {
    let synced = false;
    const post = (payload: Record<string, unknown>) =>
      window.postMessage({ source: MARKETPLACE_HELPER_APP_SOURCE, ...payload }, window.location.origin);
    const onMessage = async (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (isHelperPong(data)) {
        if (synced || !versionAtLeast(data.version, MARKETPLACE_HELPER_AD_LIST_MIN_VERSION)) return;
        synced = true;
        try {
          post({ type: "ad_list", ads: await loadAds(), at: Date.now() });
        } catch {
          /* the helper keeps the list it had */
        }
        post({ type: "get_captured" });
        if (versionAtLeast(data.version, MARKETPLACE_HELPER_RENEW_MIN_VERSION)) post({ type: "get_renewed" });
        if (versionAtLeast(data.version, MARKETPLACE_HELPER_REJECT_MIN_VERSION)) post({ type: "get_rejected" });
        if (versionAtLeast(data.version, MARKETPLACE_HELPER_REPLIED_MIN_VERSION)) post({ type: "get_replied" });
        return;
      }
      if (isHelperMessage(data, "replied_chats")) {
        try {
          const { done } = await saveReplied(data.items);
          if (done.length > 0) {
            post({ type: "replied_saved", keys: done });
            router.refresh();
          }
        } catch {
          /* kept by the helper; tried again on the next page */
        }
        return;
      }
      if (isHelperMessage(data, "rejected_ads")) {
        try {
          const { done, rentals } = await saveRejected(data.items);
          if (done.length > 0) post({ type: "rejected_saved", itemIds: done });
          if (rentals.length > 0) {
            setRemoved(rentals);
            post({ type: "ad_list", ads: await loadAds(), at: Date.now() });
            router.refresh();
          }
        } catch {
          /* kept by the helper; tried again on the next page */
        }
        return;
      }
      if (isHelperMessage(data, "renewed_ads")) {
        try {
          const { done } = await saveRenewed(data.items);
          if (done.length > 0) {
            post({ type: "renewed_saved", itemIds: done });
            router.refresh();
          }
        } catch {
          /* kept by the helper; tried again on the next page */
        }
        return;
      }
      if (isHelperMessage(data, "captured_ads")) {
        try {
          const { done } = await saveCaptured(data.items);
          if (done.length > 0) {
            post({ type: "captured_saved", itemIds: done });
            post({ type: "ad_list", ads: await loadAds(), at: Date.now() });
            router.refresh();
          }
        } catch {
          /* kept by the helper; tried again on the next page */
        }
      }
    };
    window.addEventListener("message", onMessage);
    const ping = () => window.postMessage({ source: MARKETPLACE_HELPER_APP_SOURCE, type: "ping" }, window.location.origin);
    const timers = [0, 800, 2500].map((ms) => window.setTimeout(ping, ms));
    return () => {
      window.removeEventListener("message", onMessage);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [loadAds, saveCaptured, saveRenewed, saveRejected, saveReplied, router]);
  const banner = rejectedAdsBanner(removed.map((r) => r.rental));
  if (!banner) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 w-[min(560px,calc(100%-32px))] -translate-x-1/2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900 shadow-lg"
    >
      <p>{banner}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {removed.map((r) => (
          <a key={r.propertyId} href={`/dashboard/properties/${r.propertyId}?tab=online`} className="font-semibold underline">
            Open {r.rental} →
          </a>
        ))}
        <button type="button" onClick={() => setRemoved([])} className="ml-auto text-[12px] text-amber-800 hover:underline">
          Close
        </button>
      </div>
    </div>
  );
}

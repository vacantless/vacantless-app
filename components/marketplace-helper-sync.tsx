"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  MARKETPLACE_HELPER_AD_LIST_MIN_VERSION,
  MARKETPLACE_HELPER_APP_SOURCE,
  MARKETPLACE_HELPER_RENEW_MIN_VERSION,
  isHelperMessage,
  isHelperPong,
  versionAtLeast,
  type HelperAdEntry,
} from "@/lib/marketplace-helper";

// S738: on any dashboard page, when the Vacantless helper (1.1.0+) answers,
// hand it the list of live Marketplace ads (for "Fill booking reply" in
// Facebook chats) and save any ad links it noted on the landlord's own new
// ads. Renders nothing. Same window, same origin only.
// S739: also saves the Facebook renewals the helper (1.2.0+) saw the landlord press.
export function MarketplaceHelperSync({
  loadAds,
  saveCaptured,
  saveRenewed,
}: {
  loadAds: () => Promise<HelperAdEntry[]>;
  saveCaptured: (items: unknown) => Promise<{ done: string[] }>;
  saveRenewed: (items: unknown) => Promise<{ done: string[] }>;
}) {
  const router = useRouter();
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
  }, [loadAds, saveCaptured, saveRenewed, router]);
  return null;
}

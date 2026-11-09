"use client";

import { useEffect, useState } from "react";
import {
  MARKETPLACE_HELPER_APP_SOURCE,
  MARKETPLACE_HELPER_EDIT_MIN_VERSION,
  isHelperPong,
  versionAtLeast,
  type MarketplaceHelperKit,
} from "@/lib/marketplace-helper";

// S764: after an edit, the Facebook Marketplace ad still shows the old
// details (Marketplace has no API). With helper 1.2.4 in this Chrome, one
// click opens the ad's own edit page and the helper changes only what
// differs; the landlord presses Facebook's Update button. Without it, the
// same line links straight to the ad's edit page.

type HelperState = "unknown" | "absent" | "old" | "ready";

function useHelperForUpdates(): HelperState {
  const [state, setState] = useState<HelperState>("unknown");
  useEffect(() => {
    let answered = false;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (!isHelperPong(event.data)) return;
      answered = true;
      setState(versionAtLeast(event.data.version, MARKETPLACE_HELPER_EDIT_MIN_VERSION) ? "ready" : "old");
    };
    window.addEventListener("message", onMessage);
    const ping = () =>
      window.postMessage({ source: MARKETPLACE_HELPER_APP_SOURCE, type: "ping" }, window.location.origin);
    // The helper's script can start after the first ping, so ping a few times.
    const timers = [0, 600, 1500, 3000].map((ms) => window.setTimeout(ping, ms));
    const giveUp = window.setTimeout(() => {
      if (!answered) setState("absent");
    }, 3500);
    return () => {
      window.removeEventListener("message", onMessage);
      timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(giveUp);
    };
  }, []);
  return state;
}

export function MarketplaceUpdateButton({
  kit,
  editUrl,
}: {
  /** The rental's helper kit with the live ad's id (marketplaceUpdateKit). */
  kit: MarketplaceHelperKit;
  /** Facebook's edit page for that ad (marketplaceEditUrl). */
  editUrl: string;
}) {
  const helper = useHelperForUpdates();
  const [sent, setSent] = useState(false);
  if (helper === "ready") {
    return (
      <span className="mt-2 block">
        Facebook Marketplace still shows the old details.{" "}
        <button
          type="button"
          onClick={() => {
            window.postMessage(
              { source: MARKETPLACE_HELPER_APP_SOURCE, type: "marketplace_update", kit },
              window.location.origin,
            );
            setSent(true);
          }}
          className="ml-1 inline-flex items-center rounded-lg bg-emerald-700 px-3 py-1 text-[12.5px] font-semibold text-white hover:bg-emerald-800"
        >
          Update Marketplace for me →
        </button>
        {sent ? (
          <span className="mt-1 block text-[12.5px]">
            Your ad is opening in a new tab. Press &quot;Update this ad&quot; on the Vacantless card, check the change, then press
            Facebook&apos;s Update button.
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className="mt-2 block">
      Facebook Marketplace still shows the old details.{" "}
      <a href={editUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
        Edit your Marketplace ad →
      </a>
      {helper === "old" ? (
        <span className="mt-1 block text-[12.5px]">
          Update the Vacantless helper in Chrome and it fills the change for you.
        </span>
      ) : null}
    </span>
  );
}

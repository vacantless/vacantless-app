"use client";

import { useEffect, useState } from "react";
import { MarketplaceKitSteps, type MarketplaceKitFact } from "@/components/marketplace-kit-steps";
import type { MarketplaceKitAgent } from "@/lib/marketplace-kit";
import {
  MARKETPLACE_HELPER_APP_SOURCE,
  MARKETPLACE_HELPER_INSTALL_URL,
  helperVersionOk,
  isHelperPong,
  type MarketplaceHelperKit,
} from "@/lib/marketplace-helper";
import { addListingPost } from "../actions";
import { emailMarketplacePhoneLink, sendMarketplaceKit } from "./marketplace-actions";

// S712: what the Facebook Marketplace row shows before the ad is live, for
// every org. Marketplace has no API, so the landlord's own team posts it: the
// landlord does it here in a few taps, or sends the same steps to one of their
// showing agents by email.

export type MarketplaceKitData = {
  adText: string;
  facts: MarketplaceKitFact[];
  photosHref: string;
  photoCount: number;
  /** S736: the photo links a phone saves through its share sheet. */
  photoUrls?: string[];
  /** S736: the no-sign-in kit link for the landlord's phone, and its code to scan. */
  phoneUrl?: string | null;
  phoneQrSvg?: string | null;
  renterReply: string;
  agents: MarketplaceKitAgent[];
  /** Result of the last "Send to an agent" press, from the URL (?mkt=). */
  sendNotice: "sent" | "notsent" | "noagent" | "pick" | "mailed" | "mailfail" | null;
  /** S735: the kit the Chrome helper fills into Marketplace's form. */
  helperKit?: MarketplaceHelperKit | null;
};

// S735: is the Vacantless helper installed in this Chrome? The app pings the
// page; the helper's content script answers with its version. Nothing else
// on the window is read. The helper's script starts at document_idle, which
// can be after this effect's first ping (seen live 2026-10-23: the page said
// "absent" while the helper was installed), so the page pings four times over
// three seconds, keeps listening for the life of the row, and turns "ready"
// whenever a pong arrives, even after it has shown "absent".
function useMarketplaceHelper(): "unknown" | "absent" | "old" | "ready" {
  const [state, setState] = useState<"unknown" | "absent" | "old" | "ready">("unknown");
  useEffect(() => {
    let answered = false;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (!isHelperPong(event.data)) return;
      answered = true;
      setState(helperVersionOk(event.data.version) ? "ready" : "old");
    };
    window.addEventListener("message", onMessage);
    const ping = () =>
      window.postMessage({ source: MARKETPLACE_HELPER_APP_SOURCE, type: "ping" }, window.location.origin);
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

function sendKitToHelper(kit: MarketplaceHelperKit) {
  window.postMessage(
    { source: MARKETPLACE_HELPER_APP_SOURCE, type: "marketplace_fill", kit },
    window.location.origin,
  );
}

const SEND_NOTICE: Record<NonNullable<MarketplaceKitData["sendNotice"]>, string> = {
  sent: "Sent. They have the steps by email.",
  notsent: "The email did not go out. Check the agent's email address and try again.",
  noagent: "That agent has no email address on file.",
  pick: "Pick an agent first.",
  mailed: "Sent. Open the email on your phone.",
  mailfail: "The email did not go out. Try again in a minute.",
};

const PHONE_NOTICES = new Set(["mailed", "mailfail"]);

export function MarketplaceRow({
  propertyId,
  kit,
}: {
  propertyId: string;
  kit: MarketplaceKitData;
}) {
  const [open, setOpen] = useState(kit.sendNotice != null);
  const helper = useMarketplaceHelper();
  const [sentToHelper, setSentToHelper] = useState(false);
  const helperKit = kit.helperKit ?? null;
  return (
    <div className="mt-2">
      <p className="text-[12px] text-gray-600">
        Facebook lets only people post rentals on Marketplace. So you or a showing agent posts it
        from your own Facebook. It takes a few minutes.
      </p>
      {helperKit && helper === "ready" && (
        <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-[12.5px] font-semibold text-emerald-900">The Vacantless helper is in your Chrome.</p>
          <p className="mt-0.5 text-[12px] text-emerald-900">
            One click opens Marketplace and fills the form, photos included. You check it and press Facebook's own Post button.
          </p>
          <button
            type="button"
            onClick={() => {
              sendKitToHelper(helperKit);
              setSentToHelper(true);
            }}
            className="mt-2 inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-800"
          >
            Fill Marketplace for me →
          </button>
          {sentToHelper && (
            <p className="mt-2 text-[12px] text-emerald-900">
              Marketplace is opening in a new tab. When the ad is up, paste its link in step 4 below.
            </p>
          )}
        </div>
      )}
      {helperKit && helper === "old" && (
        <p className="mt-2 text-[12px] text-amber-800">
          Your Vacantless helper is an older version. Update it in Chrome, then reload this page.
        </p>
      )}
      {helperKit && helper === "absent" && (
        <p className="mt-2 text-[12px] text-gray-600">
          Posting from a computer?{" "}
          <a href={MARKETPLACE_HELPER_INSTALL_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-indigo-700 hover:underline">
            Add the Vacantless helper to Chrome
          </a>{" "}
          and it fills the Marketplace form for you, photos included.
        </p>
      )}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700"
        >
          {helper === "ready" ? "Or do it step by step →" : "Post it on Marketplace →"}
        </button>
      ) : (
        <div className="mt-3 space-y-4">
          {kit.phoneUrl ? (
            // S736 (review item 9): most landlords post from the Facebook app.
            // Computers only; on a phone the steps below already fit.
            <div className="hidden rounded-lg border border-indigo-100 bg-indigo-50/60 p-3 md:flex md:items-center md:gap-3">
              {kit.phoneQrSvg ? (
                <div
                  className="h-[96px] w-[96px] shrink-0 overflow-hidden rounded-md border border-gray-200 bg-white p-1 [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                  // Generated server-side by the qrcode package from our own
                  // signed kit link, not user input, so the markup is trusted.
                  dangerouslySetInnerHTML={{ __html: kit.phoneQrSvg }}
                />
              ) : null}
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-gray-900">Rather post from your phone?</p>
                <p className="mt-0.5 text-[12px] text-gray-600">
                  Scan this with your phone camera. The same steps open there, photos included.
                </p>
                <form action={emailMarketplacePhoneLink} className="mt-2">
                  <input type="hidden" name="property_id" value={propertyId} />
                  <button
                    type="submit"
                    className="rounded-lg border border-indigo-600 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-indigo-700 hover:bg-indigo-50"
                  >
                    Email me the link
                  </button>
                </form>
                {kit.sendNotice && PHONE_NOTICES.has(kit.sendNotice) ? (
                  <p
                    className={`mt-2 text-[12px] ${kit.sendNotice === "mailed" ? "text-emerald-700" : "text-amber-700"}`}
                  >
                    {SEND_NOTICE[kit.sendNotice]}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
          <MarketplaceKitSteps
            adText={kit.adText}
            facts={kit.facts}
            photosHref={kit.photosHref}
            photoCount={kit.photoCount}
            photoUrls={kit.photoUrls ?? []}
            renterReply={kit.renterReply}
            saveAction={addListingPost}
            hiddenFields={{ property_id: propertyId, portal: "facebook", status: "live" }}
          />
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-[13px] font-semibold text-gray-900">Someone else posts your ads?</p>
            {kit.agents.length > 0 ? (
              <form action={sendMarketplaceKit} className="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="property_id" value={propertyId} />
                <select
                  name="agent_id"
                  defaultValue=""
                  aria-label="Showing agent"
                  className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[12.5px]"
                >
                  <option value="" disabled>
                    Pick a showing agent
                  </option>
                  {kit.agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-lg border border-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-indigo-700 hover:bg-indigo-50"
                >
                  Email them these steps
                </button>
              </form>
            ) : (
              <p className="mt-1 text-[12px] text-gray-600">
                Add a showing agent with an email. Then you can send them these steps.{" "}
                <a href="/dashboard/showing-agents" className="font-semibold text-indigo-700 hover:underline">
                  Add a showing agent →
                </a>
              </p>
            )}
            {kit.sendNotice && !PHONE_NOTICES.has(kit.sendNotice) ? (
              <p
                className={`mt-2 text-[12px] ${kit.sendNotice === "sent" ? "text-emerald-700" : "text-amber-700"}`}
              >
                {SEND_NOTICE[kit.sendNotice]}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { MarketplaceKitSteps, type MarketplaceKitFact } from "@/components/marketplace-kit-steps";
import type { MarketplaceKitAgent } from "@/lib/marketplace-kit";
import { addListingPost } from "../actions";
import { sendMarketplaceKit } from "./marketplace-actions";

// S712: what the Facebook Marketplace row shows before the ad is live, for
// every org. Marketplace has no API, so the landlord's own team posts it: the
// landlord does it here in a few taps, or sends the same steps to one of their
// showing agents by email.

export type MarketplaceKitData = {
  adText: string;
  facts: MarketplaceKitFact[];
  photosHref: string;
  photoCount: number;
  renterReply: string;
  agents: MarketplaceKitAgent[];
  /** Result of the last "Send to an agent" press, from the URL (?mkt=). */
  sendNotice: "sent" | "notsent" | "noagent" | "pick" | null;
};

const SEND_NOTICE: Record<NonNullable<MarketplaceKitData["sendNotice"]>, string> = {
  sent: "Sent. They have the steps by email.",
  notsent: "The email did not go out. Check the agent's email address and try again.",
  noagent: "That agent has no email address on file.",
  pick: "Pick an agent first.",
};

export function MarketplaceRow({
  propertyId,
  kit,
}: {
  propertyId: string;
  kit: MarketplaceKitData;
}) {
  const [open, setOpen] = useState(kit.sendNotice != null);
  return (
    <div className="mt-2">
      <p className="text-[12px] text-gray-600">
        Facebook lets only people post rentals on Marketplace. So you or a showing agent posts it
        from your own Facebook. It takes a few minutes.
      </p>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700"
        >
          Post it on Marketplace →
        </button>
      ) : (
        <div className="mt-3 space-y-4">
          <MarketplaceKitSteps
            adText={kit.adText}
            facts={kit.facts}
            photosHref={kit.photosHref}
            photoCount={kit.photoCount}
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
            {kit.sendNotice ? (
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

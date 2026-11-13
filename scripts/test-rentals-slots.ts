// S785: the Rentals.ca "free ads full" stop as a one-click choice.
// Run: npx tsx scripts/test-rentals-slots.ts
import { readFileSync } from "node:fs";
import { rentersWord, shortAddress, slotWaitMessage, slotWaitNote, sortWeakestFirst, SLOT_WAIT_CODE } from "../lib/rentals-slots";
import { siteSetupNotice } from "../lib/distribution-publish";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL", name);
  }
};

const ads = [
  { listingPostId: "a", propertyId: "p36", address: "833 Pillette Rd, Unit 36, Windsor, ON N8Y 3B4", renters30: 1 },
  { listingPostId: "b", propertyId: "p9", address: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2", renters30: 0 },
];
const sorted = sortWeakestFirst(ads);
ok("weakest first", sorted[0].listingPostId === "b" && sorted[1].listingPostId === "a");
ok("does not reorder the input", ads[0].listingPostId === "a");
ok("short address keeps the unit", shortAddress(ads[1].address) === "1551 Assumption St, Unit 9");
ok("short address plain street", shortAddress("251 Manitoba St, Windsor, ON") === "251 Manitoba St");
ok("renters words", rentersWord(0) === "no renters" && rentersWord(1) === "1 renter" && rentersWord(16) === "16 renters");
ok("note names the takedown and the user", slotWaitNote("t1", "u1") === "slot_after:t1 slot_by:u1" && slotWaitNote("t1", null) === "slot_after:t1");
const msg = slotWaitMessage(ads[1].address);
ok("wait message names the ad", msg.includes("1551 Assumption St, Unit 9") && !msg.includes("—"));
ok("code", SLOT_WAIT_CODE === "waiting_for_free_slot");
const n = siteSetupNotice("needs_operator", "waiting_for_free_slot", msg);
ok("waiting notice shows the message", n?.message === msg);
ok("full notice unchanged", siteSetupNotice("needs_operator", "free_limit_reached", null)?.message.includes("free ads") === true);

const page = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
ok("top summary names free ads full", page.includes('"site with free ads full"') && page.includes('item.errorCode === "free_limit_reached"'));
ok("slots loaded only when this rental is stopped", page.includes('.in("run_id", slotRunIds') && page.includes("loadRentalsSlotChoice(supabase"));
const pe = readFileSync("app/dashboard/properties/[id]/publish-everywhere.tsx", "utf8");
ok("chooser posts the switch action", pe.includes("<form action={switchRentalsSlot}>") && pe.includes('name="weak_listing_post_id"'));
ok("no approve button while choosing or waiting", pe.includes("item?.slotChoice || item?.waitingForSlot ? null"));
const act = readFileSync("app/dashboard/properties/distribution-actions.ts", "utf8");
const fn = act.slice(act.indexOf("export async function switchRentalsSlot"));
ok("action needs manage_properties", fn.includes('requireCapability("manage_properties"'));
ok("action checks the stop and the weak ad in this org", fn.includes('.eq("error_code", "free_limit_reached")') && fn.includes('.eq("portal", "rentals_ca")') && fn.includes('.eq("status", "live")'));
ok("action queues only the Rentals.ca takedown", fn.includes('portals: ["rentals_ca"]'));
ok("action parks the rental, never approves it", fn.includes("error_code: SLOT_WAIT_CODE") && !fn.includes("operator_submit_approved_at"));
ok("action wakes the home runner", fn.includes("triggerRentalsTakedown()"));
const all = [page, pe, act, readFileSync("lib/rentals-slots.ts", "utf8")].join("\n");
ok("no em dashes in new copy", !/Switch [^\n]*—|free ads[^\n]*—/.test(all) && !readFileSync("lib/rentals-slots.ts", "utf8").includes("—"));
ok("waiting summary, never a repost", page.includes('"site making room"') && /for \(const key of slotWait\.keys\(\)\) \{\s*repost\.delete\(key\);/.test(page));
import("../lib/for-you-row-state").then(({ forYouRowState }) => {
  const st = forYouRowState({
    rowKey: "rentals_ca",
    item: { mode: "concierge", publishStatus: "needs_operator", externalUrl: null, waitingForSlot: true, siteSetup: { message: "m", href: "h", action: "a" } },
    liveProofUrl: null, retiredUrls: [], alreadySignedIn: true, addonLocked: false, postingBlocked: false, hasMarketplaceKit: false,
  });
  ok("waiting row reads Posting, not Needs you", st.word === "Posting");
  return import("../lib/rentals-slots").then(({ slotIsStuck, slotTakedownId }) => {
  ok("stuck reads the worker prefix", slotIsStuck("The switch stopped: the Rentals.ca sign-in has expired.") && !slotIsStuck("Switching x off"));
  ok("takedown id from note", slotTakedownId("slot_after:3f1c2d4e-1111-4abc-8def-0123456789ab slot_by:x") === "3f1c2d4e-1111-4abc-8def-0123456789ab");
  const st = siteSetupNotice("needs_operator", "waiting_for_free_slot", "The switch stopped: the Rentals.ca sign-in has expired. Sign in again, then press Try the switch again.");
  ok("stuck notice links to sign-in", st?.href === "/dashboard/site-signin/rentals_ca");
  const retry = act.slice(act.indexOf("export async function retryRentalsSlot"));
  ok("retry requeues only that takedown", retry.includes('.eq("transport", "takedown")') && retry.includes('publish_status: "queued"') && retry.includes("triggerRentalsTakedown()"));
  ok("retry button shows only when stuck", pe.includes("item?.slotStuck ? (") && pe.includes("<form action={retryRentalsSlot}>"));
  });
}).then(() => {
  done();
});
function done() {
console.log(`rentals-slots: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
}

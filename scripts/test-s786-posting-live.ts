// S786: the Get online tab updates itself, "I paid", paid-capture notes,
// and the Rentals.ca switch dead ends. Run: npx tsx scripts/test-s786-posting-live.ts
import { existsSync, readFileSync } from "node:fs";
import { itemInFlight, postingInFlight, refreshDelayMs } from "../lib/posting-in-flight";
import { CAPTURE_NOTE_PREFIX, captureNote, offersIPaid, paidPressedAt, paidPressedNote } from "../lib/paid-capture-note";
import { madeRoomLine, madeRoomPairs, slotWaitMessage } from "../lib/rentals-slots";
import { postingCoverage } from "../lib/posting-coverage";
import { forYouRowState } from "../lib/for-you-row-state";
import { PAID_CAPTURE_EVENT } from "../lib/post-now";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL", name);
  }
};

// 1. in flight
const c = (o: Record<string, unknown>) => ({ mode: "concierge", publishStatus: "queued", ...o }) as any;
ok("queued moves", itemInFlight(c({})));
ok("live does not", !itemInFlight(c({ publishStatus: "live" })));
ok("unapproved needs_operator does not", !itemInFlight(c({ publishStatus: "needs_operator" })));
ok("approved needs_operator moves", itemInFlight(c({ publishStatus: "needs_operator", approved: true })));
ok("slot wait moves", itemInFlight(c({ publishStatus: "needs_operator", waitingForSlot: true })));
ok("stuck slot does not", !itemInFlight(c({ publishStatus: "needs_operator", waitingForSlot: true, slotStuck: true })));
ok("checkout waiting does not", !itemInFlight(c({ publishStatus: "needs_payment" })));
ok("I paid moves", itemInFlight(c({ publishStatus: "needs_payment", paidPressed: true })));
ok("I paid with a note does not", !itemInFlight(c({ publishStatus: "needs_payment", paidPressed: true, captureNote: "x" })));
ok("instant mode never", !itemInFlight({ mode: "instant", publishStatus: "queued" }));
ok("any of many", postingInFlight([c({ publishStatus: "live" }), c({})]) && !postingInFlight([]));
ok("20 s then a minute", refreshDelayMs(0) === 20000 && refreshDelayMs(11 * 60000) === 60000);

// 2. I paid
const iso = "2026-11-13T14:00:00.000Z";
ok("note round trip", paidPressedAt(`old\n${paidPressedNote(iso)}`)?.toISOString() === iso);
ok("no note", paidPressedAt("slot_after:x") === null && paidPressedAt(null) === null);
ok("kijiji only", offersIPaid("kijiji") && !offersIPaid("rentals_ca"));
ok("event name matches worker", PAID_CAPTURE_EVENT === "paid-capture");
ok("capture note read", captureNote(`${CAPTURE_NOTE_PREFIX} your Kijiji sign-in has expired.`) === "Your Kijiji sign-in has expired.");
ok("other error ignored", captureNote("Something else") === null);
// The worker repo sits beside this one on the Mac; CI has only this repo.
const workerFile = new URL("../../vacantless-worker/src/paid-capture-logic.ts", import.meta.url);
if (existsSync(workerFile)) {
  ok("prefix matches worker", readFileSync(workerFile, "utf8").includes(`CAPTURE_NOTE_PREFIX = "${CAPTURE_NOTE_PREFIX}"`));
}

// row word: I paid reads Posting, a capture note reads Needs you
const base = { rowKey: "kijiji", liveProofUrl: null, retiredUrls: [], alreadySignedIn: true, addonLocked: false, postingBlocked: false, hasMarketplaceKit: false };
const pay = { mode: "concierge", publishStatus: "needs_payment", checkoutUrl: "https://www.kijiji.ca/m-my-ads/inactive/1", externalUrl: null };
ok("pay is Needs you", forYouRowState({ ...base, item: pay }).word === "Needs you");
ok("I paid is Posting", forYouRowState({ ...base, item: { ...pay, paidPressed: true } }).word === "Posting");
ok("note is Needs you", forYouRowState({ ...base, item: { ...pay, paidPressed: true, captureNote: "x" } }).word === "Needs you");

// 4. slot switch
ok("wait copy says minutes", /a few minutes/.test(slotWaitMessage("1551 Assumption St, Unit 9, Windsor")) && !/within a day/.test(slotWaitMessage("x")));
const waiters = [{ beneficiaryPropertyId: "u3", beneficiaryAddress: "833 Pillette Rd, Unit 3, Windsor, ON", waiting: false, takedownItemId: "t1" }];
const tp = new Map([["t1", "a9"]]);
ok("made room while beneficiary live", madeRoomPairs({ waiters, takedownProperty: tp, liveOnRentals: new Set(["u3"]) }).get("a9") === "833 Pillette Rd, Unit 3");
ok("made room while waiting", madeRoomPairs({ waiters: [{ ...waiters[0], waiting: true }], takedownProperty: tp, liveOnRentals: new Set() }).has("a9"));
ok("not once beneficiary is gone", !madeRoomPairs({ waiters, takedownProperty: tp, liveOnRentals: new Set() }).has("a9"));
ok("not when weak is live again", !madeRoomPairs({ waiters, takedownProperty: tp, liveOnRentals: new Set(["u3", "a9"]) }).has("a9"));
ok("room line", /make room for 833 Pillette Rd, Unit 3/.test(madeRoomLine("833 Pillette Rd, Unit 3")));

const cov = postingCoverage({
  properties: [{ id: "a9", address: "1551 Assumption St, Unit 9", status: "available" }],
  posts: [{ propertyId: "a9", portal: "facebook", status: "live" }],
  sessions: [{ channel: "rentals_ca", alive: true }, { channel: "kijiji", alive: true }],
  postingAddon: true,
  madeRoom: new Map([["a9", "833 Pillette Rd, Unit 3"]]),
});
ok("Rentals.ca not missing after making room", !cov.rows[0].missing.includes("rentals_ca") && cov.rows[0].missing.includes("kijiji"));
ok("made room carried on the row", cov.rows[0].madeRoomFor === "833 Pillette Rd, Unit 3");
const cov2 = postingCoverage({
  properties: [{ id: "a9", address: "x", status: "available" }],
  posts: [],
  sessions: [{ channel: "rentals_ca", alive: true }],
  postingAddon: true,
});
ok("without it Rentals.ca is missing", cov2.rows[0].missing.includes("rentals_ca"));

// page wiring
const pe = readFileSync(new URL("../app/dashboard/properties/[id]/publish-everywhere.tsx", import.meta.url), "utf8");
ok("live refresh mounted", pe.includes("<LiveRefresh active={postingInFlight(runItems)} />"));
ok("no reload copy", !/Reload this page/.test(pe));
ok("I paid button", pe.includes("action={notePaidOnSite}") && pe.includes(">\n                  I paid\n"));
ok("I turned it off button", pe.includes("action={slotDoneByHand}"));
ok("switch asks first", pe.includes("Yes, switch") && pe.includes("setPicked("));
const page = readFileSync(new URL("../app/dashboard/properties/[id]/page.tsx", import.meta.url), "utf8");
ok("failed banner drops dead end", !/You can also turn one off on Rentals.ca yourself/.test(page));
ok("banners", page.includes('"paid_noted"') && page.includes('"slot_done_by_hand"'));

console.log(`s786-posting-live: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

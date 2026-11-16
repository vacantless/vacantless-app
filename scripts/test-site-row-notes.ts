// S805: the notes on a rental's site rows (your choice, took it down) and
// Today's "took an ad down" card. Pure.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSiteRowNotes,
  choiceLine,
  dropLine,
  droppedAdNotices,
  liveCheckRemovalDay,
  shortDay,
} from "../lib/site-row-notes";
import { forYouRowState } from "../lib/for-you-row-state";
import { shortAddress } from "../lib/posting-coverage";

let n = 0;
const ok = (name: string, cond: unknown) => {
  n++;
  assert.ok(cond, name);
};
const eq = (name: string, a: unknown, b: unknown) => {
  n++;
  assert.deepEqual(a, b, name);
};

const NOW = "2026-11-16T18:00:00.000Z";
const zumperNotes =
  "S699 posted by hand\nlive-check 2026-11-15 19:53Z: REMOVED (zumper_notify_me_page). Row flipped live -> removed.\n2026-11-15 expiry re-post: not queued (no run item made this ad); use Post to the missing sites.";

eq("short day", shortDay("2026-11-15"), "Nov 15");
eq("short day single digit", shortDay("2026-01-05"), "Jan 5");
eq("removal day read past the re-post line", liveCheckRemovalDay(zumperNotes), "2026-11-15");
eq("home check line", liveCheckRemovalDay("2026-10-26 home live check: Rentals.ca no longer shows this ad"), "2026-10-26");
eq("a person's later note wins", liveCheckRemovalDay(`${zumperNotes}\nNoam: leaving it off`), null);
eq("no notes", liveCheckRemovalDay(null), null);

ok("fee line names the price and who is paid", choiceLine("kijiji", "fee", "$33.84") === "Your choice. Kijiji charges $33.84 for this ad, and you pay it on Kijiji.");
ok("full line says what to do", choiceLine("rentals_ca", "full", null).includes("switch another off"));
eq("drop line", dropLine("zumper", "2026-11-15"), "Zumper took this ad down on Nov 15. Post it again to put it back up.");

const posts = [
  { portal: "zumper", status: "removed", notes: zumperNotes, created_at: "2026-09-30T21:26:04Z" },
  { portal: "facebook", status: "live", notes: null, created_at: "2026-09-30T20:52:14Z" },
  { portal: "rentals_ca", status: "removed", notes: "taken down to make room", created_at: "2026-10-11T12:58:09Z" },
];
const notes = buildSiteRowNotes({
  posts,
  optional: [{ channel: "kijiji", reason: "fee" }],
  priceByChannel: { kijiji: "$33.84" },
  rentalAvailable: true,
  nowISO: NOW,
});
eq("Zumper says it took the ad down", notes.zumper?.dropLine, "Zumper took this ad down on Nov 15. Post it again to put it back up.");
ok("Zumper is not a choice", !notes.zumper?.choice);
eq("Kijiji is a choice with a priced button", [notes.kijiji?.choice, notes.kijiji?.choiceButton], ["fee", "Post here, $33.84"]);
ok("a removal no live check wrote says nothing", notes.rentals_ca === undefined);
ok("Marketplace gets no note", notes.facebook === undefined);
eq("a rented rental gets no notes", buildSiteRowNotes({ posts, optional: [{ channel: "kijiji", reason: "fee" }], rentalAvailable: false, nowISO: NOW }), {});
ok(
  "a newer live ad on the site clears the drop",
  buildSiteRowNotes({ posts: [...posts, { portal: "zumper", status: "live", notes: null, created_at: "2026-11-16T10:00:00Z" }], optional: [], rentalAvailable: true, nowISO: NOW }).zumper === undefined,
);
ok(
  "an old drop is history",
  buildSiteRowNotes({ posts, optional: [], rentalAvailable: true, nowISO: "2027-01-10T00:00:00Z" }).zumper === undefined,
);
ok("full with no price keeps the usual button", buildSiteRowNotes({ posts: [], optional: [{ channel: "rentals_ca", reason: "full" }], rentalAvailable: true, nowISO: NOW }).rentals_ca?.choiceButton === null);

// Today's card
const rows = [
  { propertyId: "u9", address: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2", missing: ["zumper"] },
  { propertyId: "u3", address: "833 Pillette Rd, Unit 3, Windsor, ON", missing: [] },
];
const cardPosts = posts.map((p) => ({ ...p, property_id: "u9" }));
const cards = droppedAdNotices({ rows, posts: cardPosts, shortAddress, nowISO: NOW });
eq("one card", cards.length, 1);
eq("card title", cards[0].title, "Zumper took an ad down.");
eq("card line", cards[0].line, "1551 Assumption St, Unit 9, on Nov 15. Post it again to put it back up.");
ok("card opens the rental's row", cards[0].action.href === "/dashboard/properties/u9?tab=distribute#for-you-zumper");
eq("a paid site whose ad ended earns no card (not in missing)", droppedAdNotices({ rows: [{ ...rows[0], missing: [] }], posts: cardPosts, shortAddress, nowISO: NOW }), []);
eq("after a week the card goes", droppedAdNotices({ rows, posts: cardPosts, shortAddress, nowISO: "2026-11-24T00:00:00Z" }), []);

// The row's word
const base = {
  rowKey: "kijiji",
  item: null,
  liveProofUrl: null,
  retiredUrls: [] as string[],
  alreadySignedIn: true,
  addonLocked: false,
  postingBlocked: false,
  hasMarketplaceKit: false,
};
eq("signed in, nothing queued, a fee: Your choice", forYouRowState({ ...base, choice: true }).word, "Your choice");
eq("signed in, nothing queued, free: Needs you", forYouRowState({ ...base }).word, "Needs you");
eq("not signed in stays Needs you even with a fee", forYouRowState({ ...base, alreadySignedIn: false, choice: true }).word, "Needs you");
eq("checkout waiting stays Needs you", forYouRowState({ ...base, choice: true, item: { mode: "concierge", publishStatus: "needs_payment", checkoutUrl: "https://k/x", externalUrl: null } }).word, "Needs you");
eq("a rejected paid ad that can be posted again is a choice", forYouRowState({ ...base, choice: true, item: { mode: "concierge", publishStatus: "rejected", externalUrl: null } }).word, "Your choice");
eq("the same on a free site is Needs you", forYouRowState({ ...base, item: { mode: "concierge", publishStatus: "rejected", externalUrl: null } }).word, "Needs you");
eq("a live ad is On", forYouRowState({ ...base, choice: true, liveProofUrl: "https://www.kijiji.ca/v-x/1" }).word, "On");
eq("queued stays Posting", forYouRowState({ ...base, choice: true, item: { mode: "concierge", publishStatus: "queued", externalUrl: null } }).word, "Posting");

// Wiring and words
const pe = readFileSync("app/dashboard/properties/[id]/publish-everywhere.tsx", "utf8");
ok("the headline and the row both pass the choice", (pe.match(/choice: Boolean\(/g) ?? []).length === 2);
ok("the row shows the took-it-down line", pe.includes("siteNote.dropLine"));
const today = readFileSync("app/dashboard/page.tsx", "utf8");
ok("Today shows the dropped-ad cards", today.includes("...needsYou, ...droppedAds"));
const lib = readFileSync("lib/site-row-notes.ts", "utf8");
ok("no long dash in the copy", !lib.includes("—") && !lib.includes("–"));

console.log(`PASS test-site-row-notes (${n} checks)`);

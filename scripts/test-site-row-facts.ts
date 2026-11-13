// S786c: the line under each live site. Run: npx tsx scripts/test-site-row-facts.ts
import { readFileSync } from "node:fs";
import { checkedLine, daysLeftLine, siteMark, siteRenters, siteRowFacts } from "../lib/site-row-facts";

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL", name);
  }
};

// Unit 3's renter sources as the live card showed them 2026-11-12.
const rows = [
  { site: "Kijiji", enquiries: 4, booked: 0 },
  { site: "Rentals.ca", enquiries: 3, booked: 0 },
  { site: "Facebook Marketplace", enquiries: 2, booked: 1 },
  { site: "Zumper + PadMapper", enquiries: 1, booked: 0 },
  { site: "Your Vacantless page link", enquiries: 4, booked: 1 },
];
ok("kijiji", siteRenters(rows, "kijiji").renters === 4);
ok("marketplace", siteRenters(rows, "facebook").renters === 2 && siteRenters(rows, "facebook").booked === 1);
ok("rentals", siteRenters(rows, "rentals_ca").renters === 3);
ok("zumper", siteRenters(rows, "zumper").renters === 1);
ok("page link is no site", siteRenters(rows, "facebook_feed").renters === 0);

const now = new Date("2026-11-13T13:00:00Z");
ok("days left", daysLeftLine("2026-12-13T20:00:00Z", now) === "31 days left");
ok("one day", daysLeftLine("2026-11-14T12:00:00Z", now) === "1 day left");
ok("past is nothing", daysLeftLine("2026-11-01T00:00:00Z", now) === null);
ok("no expiry", daysLeftLine(null, now) === null);
ok("seen hour", checkedLine("2026-11-13T12:30:00Z", now) === "seen live in the last hour");
ok("seen hours", checkedLine("2026-11-13T10:00:00Z", now) === "seen live 3 hours ago");
ok("seen yesterday", checkedLine("2026-11-12T12:00:00Z", now) === "seen live yesterday");
ok(
  "full line",
  siteRowFacts({ renters: 2, booked: 1, expiresAt: "2026-12-13T20:00:00Z", verifiedAt: "2026-11-13T10:00:00Z", now }) ===
    "2 renters, 1 booked · 31 days left · seen live 3 hours ago",
);
ok("no renters yet", siteRowFacts({ renters: 0, booked: 0, now }) === "No renters yet");
ok("one renter", siteRowFacts({ renters: 1, booked: 0, now }) === "1 renter");
ok("marks", siteMark("kijiji").text === "K" && siteMark("rentals_ca").text === "R" && siteMark("nope", "Acme").text === "A");

const pe = readFileSync("app/dashboard/properties/[id]/publish-everywhere.tsx", "utf8");
ok("no emoji glyphs left", !pe.includes("CHANNEL_GLYPH") && !/🅺|🏢|📍|🛒/.test(pe));
ok("fact under live link", pe.includes('{siteFact ? <p className="mt-1 text-sm text-gray-500">{siteFact}</p> : null}'));
const page = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
ok("page reads last_verified_at", page.includes("external_expires_at, last_verified_at"));
ok("page passes facts", page.includes("siteFacts={siteFacts}"));

const tw = readFileSync("tailwind.config.ts", "utf8");
ok("tailwind scans lib (site mark colours)", tw.includes("./lib/**/"));
ok("facts read live records on any run", page.includes("liveFactByChannel.get(ch)") && page.includes('.in("run_id", slotRunIds.length > 0'));
console.log(`site-row-facts: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

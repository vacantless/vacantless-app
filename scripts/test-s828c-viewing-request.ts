// S828c: "When can you come?" on request-only rentals, and "I book each
// viewing myself" stops the set-viewing-times prompts.
// Run: npx tsx scripts/test-s828c-viewing-request.ts
import { readFileSync } from "node:fs";
import { availabilityLine, notesWithAvailability, requestNoteLine, AVAILABILITY_PILLS } from "../lib/viewing-request";
import { rentalRowReadiness } from "../lib/rental-readiness";
import { buildShareReadiness } from "../lib/share-readiness";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

ok("pills in a fixed order", availabilityLine(["Saturday", "Weekday evening"], "") === "Weekday evening, Saturday");
ok("pills and a note", availabilityLine(["Sunday"], "  after 6 on Tuesday ") === "Sunday. after 6 on Tuesday");
ok("note only", availabilityLine([], "mornings") === "mornings");
ok("nothing given is null", availabilityLine([], "  ") === null);
ok("unknown pill dropped", availabilityLine(["Midnight", "Saturday"], "") === "Saturday");
ok("duplicate pill once", availabilityLine(["Saturday", "Saturday"], "") === "Saturday");
ok("note clipped", (availabilityLine([], "x".repeat(400)) ?? "").length === 120);
ok("five pills", AVAILABILITY_PILLS.length === 5);

ok("notes keep the message first", notesWithAvailability("Is parking free?", "Saturday") === "Is parking free?\n\nWhen I can come: Saturday");
ok("notes with no message", notesWithAvailability("", "Saturday") === "When I can come: Saturday");
ok("notes empty stays null", notesWithAvailability("", null) === null);

ok("by request: email names their times", requestNoteLine({ noTimesOpen: true, noSuitableTime: true, byRequest: true, availability: "Saturday" }) === "They can come: Saturday.");
ok("by request: says when they gave none", /did not say/.test(requestNoteLine({ noTimesOpen: true, noSuitableTime: true, byRequest: true, availability: null })));
ok("calendar landlord still told to open times", /Open your times/.test(requestNoteLine({ noTimesOpen: true, noSuitableTime: true, byRequest: false, availability: null })));
ok("calendar landlord also gets their times", /They can come: Sunday/.test(requestNoteLine({ noTimesOpen: true, noSuitableTime: true, byRequest: false, availability: "Sunday" })));
ok("booked a time: no line", requestNoteLine({ noTimesOpen: false, noSuitableTime: false, byRequest: true, availability: null }) === "");

const base = { status: "available", rentCents: 159500, beds: 1, baths: 1, address: "50 Glenrose", description: "x".repeat(200), photoCount: 10, availabilityWindowCount: 0 };
const v = (by: boolean) => rentalRowReadiness({ ...base, viewingsByRequest: by }).find((s) => s.key === "viewings");
ok("no times, calendar: warn", v(false)?.tone === "warn");
ok("no times, by request: ok", v(true)?.tone === "ok" && v(true)?.ok === true);
const share = (by: boolean) => buildShareReadiness({ status: "available", rentCents: 1, beds: 1, baths: 1, address: "a", photoCount: 1, availabilityWindowCount: 0, replyToEmail: "a@b.c", viewingsByRequest: by }).checks.find((c) => c.key === "viewing_times")?.ok;
ok("share check passes by request", share(true) === true && share(false) === false);

const form = readFileSync("app/r/[propertyId]/inquiry-form.tsx", "utf8");
ok("form asks when they can come, only without open times", form.includes("{!hasSlots && (\n          <fieldset className=\"space-y-2\">") && form.includes("When can you come?"));
ok("form sends pills and note", form.includes('name="avail"') && form.includes('name="avail_note"'));
const actions = readFileSync("app/r/[propertyId]/actions.ts", "utf8");
ok("action stores and emails the times", actions.includes("notesWithAvailability(notes, availability)") && actions.includes("requestNoteLine({"));
const trip = readFileSync("app/api/cron/availability-tripwire/route.ts", "utf8");
ok("times-ran-out email skips by-request landlords", trip.includes('skipped: "by_request"'));
const home = readFileSync("app/dashboard/page.tsx", "utf8");
ok("Today card quiet for by-request landlords", home.includes("openViewingTimes === 0 && !viewingsByRequest"));
const avail = readFileSync("app/dashboard/availability/page.tsx", "utf8");
ok("switch on the Viewings page", avail.includes("I book each viewing myself") && avail.includes("action={setViewingsByRequest}"));
const mig = readFileSync("supabase/migrations/0318_viewings_by_request.sql", "utf8");
ok("migration adds the column, off by default", mig.includes("viewings_by_request boolean not null default false"));

console.log(`\ns828c-viewing-request: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

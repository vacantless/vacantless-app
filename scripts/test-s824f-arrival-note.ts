// S824f: the renter arrival note. Run: npx tsx scripts/test-s824f-arrival-note.ts
import { readFileSync } from "node:fs";
import { ARRIVAL_NOTE_MAX, arrivalNoteForSms, cleanArrivalNote, looksLikeAccessCode } from "../lib/arrival-note";
import { arrivalLines, bookingConfirmationSms, showingReminderSms } from "../lib/sms";
import { CATALOG_MESSAGES, eventGoesTo } from "../lib/message-catalog";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}${extra !== undefined ? ` ${JSON.stringify(extra)}` : ""}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");

// Clean and cap.
ok("trims and single-spaces", cleanArrivalNote("  Buzz 20\n at the   front door. ") === "Buzz 20 at the front door.");
ok("empty is null", cleanArrivalNote("   ") === null && cleanArrivalNote(null) === null);
ok("capped", (cleanArrivalNote("x".repeat(500)) ?? "").length === ARRIVAL_NOTE_MAX);

// Codes stay out.
ok("buzzer number passes", !looksLikeAccessCode("Buzz 20 at the front door."));
ok("unit number passes", !looksLikeAccessCode("Unit 2014 is on the second floor."));
ok("lockbox code refused", looksLikeAccessCode("Lockbox code 4821 on the meter"));
ok("door code refused", looksLikeAccessCode("The door code is 1234"));
ok("keypad refused", looksLikeAccessCode("keypad 90210#"));
ok("pin refused", looksLikeAccessCode("PIN 5521"));

// Text version.
ok("sms adds a full stop", arrivalNoteForSms("Buzz 20") === "Buzz 20.");
const long = "Buzz 20 at the front door, then take the elevator to the third floor and turn left past the laundry room to reach the unit.";
const short = arrivalNoteForSms(long);
ok("sms is short", short.length <= 121, short.length);
ok("sms cut at a word", !/\s\S{1,2}\.$/.test(short) || short.endsWith("."));
ok("empty sms", arrivalNoteForSms(null) === "");

// The texts carry it; the day-before reminder stays short.
ok("lines: note then phone", arrivalLines({ arrival_note: "Buzz 20", arrival_phone: "226-555-0100" }) === "Buzz 20. When you arrive, call 226-555-0100. ");
const conf = bookingConfirmationSms({ org_name: "Agile", property_address: "1 Main St", when_label: "Fri 5 pm", arrival_note: "Buzz 20", arrival_phone: "226-555-0100" });
ok("booking text has the note", conf.includes("Buzz 20. When you arrive, call 226-555-0100."), conf);
const same = showingReminderSms({ org_name: "Agile", property_address: "1 Main St", when_label: "Fri 5 pm", arrival_note: "Buzz 20", confirmed: true }, "sameday");
ok("same-day text has the note", same.includes("Buzz 20."), same);
const dayBefore = showingReminderSms({ org_name: "Agile", property_address: "1 Main St", when_label: "Fri 5 pm", arrival_note: "Buzz 20", confirmed: true }, "24h");
ok("day-before text skips it", !dayBefore.includes("Buzz 20"), dayBefore);

// Emails render it once, escaped, in the shared logistics block.
const email = read("lib/email.ts");
ok("email renders the note", email.includes("<strong>When you arrive:</strong> ${escapeHtml(note)}"));
ok("all three logistics calls pass it", (email.match(/arrival_note: p\.arrival_note, brand \}\)/g) ?? []).length === 3);

// Every renter path passes it.
for (const f of [
  "app/r/[propertyId]/actions.ts",
  "app/showing/offer/[token]/actions.ts",
  "app/showing/reschedule/[token]/actions.ts",
  "app/api/cron/reminders/route.ts",
  "app/dashboard/showings/actions.ts",
  "app/dashboard/leads/[id]/book-actions.ts",
]) {
  ok(`${f} passes the note`, /arrival_note: /.test(read(f)));
}
// Booking for a renter now uses the rental's own arrival phone.
ok("staff booking uses the rental's phone", read("app/dashboard/leads/[id]/book-actions.ts").includes("lead!.property?.showing_arrival_phone"));

// Saved safely, and shared with the building on request.
const save = read("app/dashboard/properties/actions.ts");
ok("refuses a code before saving", save.indexOf("looksLikeAccessCode(arrivalNote)") < save.indexOf("renter_arrival_note: arrivalNote }"));
ok("building copy uses sameBuilding", save.includes('formData.get("renter_arrival_note_building") === "yes"') && save.includes("sameBuilding(r.address, address)"));
ok("sister fill copies it", read("lib/sister-unit-fill.ts").includes('"renter_arrival_note"'));

// The database: capped column, and the booking extras return it.
const mig = read("supabase/migrations/0315_renter_arrival_note.sql");
ok("column capped at 300", mig.includes("char_length(renter_arrival_note) <= 300"));
ok("extras return the note", mig.includes("'arrival_note', nullif(btrim(p.renter_arrival_note), '')"));
ok("extras keep the old fields", ["'leasing_phone'", "'plan'", "'mail_alias'", "'booking_requires_confirmation'"].every((k) => mig.includes(k)));

// The messages page says what each one includes and who gets it.
const booking = CATALOG_MESSAGES.find((m) => m.id === "renter-booking-confirmation");
ok("booking row includes the note", (booking?.includes ?? "").includes("arrival note"));
ok("every row says who gets it", CATALOG_MESSAGES.every((m) => m.goesTo.trim().length > 0));
ok("agent event goes to the agent", eventGoesTo({ key: "leasing.showing_assigned", audience: "operator" }).includes("showing agent"));

console.log(`\ns824f arrival note: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

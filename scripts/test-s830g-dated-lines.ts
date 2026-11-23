// S830g: dated lines in a description expire (Noam 2026-11-22).
// Run: npx tsx scripts/test-s830g-dated-lines.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyDatedLineFix, dateInSentence, datedLineNotice, expiredDatedLines } from "../lib/dated-lines";

let n = 0;
const eq = (got: unknown, want: unknown, m: string) => {
  assert.deepEqual(got, want, m);
  n++;
};

// 251 Manitoba's own text, before the S830 cut.
const d =
  "Two-storey garden-suite living.\n\nAsking $3,150 per month. Available December 15, 2026.\n\nNo showings before October 26, 2026. First appointment dates to be confirmed. All viewings by confirmed appointment.\n\nFor details, contact Noam.";

eq(expiredDatedLines(d, "2026-11-22").map((l) => l.sentence), ["No showings before October 26, 2026."], "only the past date, on Nov 22");
eq(expiredDatedLines(d, "2026-12-16").map((l) => [l.sentence, l.replacement]), [
  ["Available December 15, 2026.", "Available now."],
  ["No showings before October 26, 2026.", ""],
], "after Dec 15 the move-in line becomes Available now");
eq(expiredDatedLines(d, "2026-10-26"), [], "the day itself is not past");

eq(
  applyDatedLineFix(d, "No showings before October 26, 2026."),
  "Two-storey garden-suite living.\n\nAsking $3,150 per month. Available December 15, 2026.\n\nFirst appointment dates to be confirmed. All viewings by confirmed appointment.\n\nFor details, contact Noam.",
  "cut keeps the rest of the paragraph",
);
eq(
  applyDatedLineFix(d, "Available December 15, 2026."),
  "Two-storey garden-suite living.\n\nAsking $3,150 per month. Available now.\n\nNo showings before October 26, 2026. First appointment dates to be confirmed. All viewings by confirmed appointment.\n\nFor details, contact Noam.",
  "available line is replaced, not cut",
);
eq(applyDatedLineFix("Open house Oct 3.\n\nNice unit.", "Open house Oct 3."), "Nice unit.", "a whole paragraph cut leaves no gap");
eq(applyDatedLineFix(d, "Not in the text."), null, "a sentence no longer there is not fixed");

eq(dateInSentence("Open house Dec 15th", "2027-01-10"), "2026-12-15", "no year in January reads last December");
eq(dateInSentence("Move in 1st Dec", "2026-11-22"), "2026-12-01", "day before month");
eq(dateInSentence("Built in 2019 with 2 beds", "2026-11-22"), null, "a year alone is not a date");
eq(dateInSentence("Rent is $1,250 for May 2027", "2026-11-22"), null, "month and year with no day is not a date");
eq(dateInSentence("Ready 2026-10-01.", "2026-11-22"), "2026-10-01", "ISO date");
eq(dateInSentence("Available Feb 30", "2026-11-22"), null, "not a real day");

const line = expiredDatedLines(d, "2026-11-22")[0];
const notice = datedLineNotice("251 Manitoba", line);
assert.ok(notice.includes("That date has passed") && notice.includes("Remove it?"), "notice wording");
assert.ok(!/[—–]/.test(notice), "no dashes");
n += 2;

// Wiring: the rental page card, the Today card, and the fix runs the edit path.
const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
assert.ok(/export async function fixDatedLine[\s\S]*applyDatedLineFix[\s\S]*queueAdUpdates\(/.test(actions), "fix edits the text then updates the ads");
assert.ok(actions.includes('requireCapability("manage_properties"') , "fix needs the edit permission");
const page = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
assert.ok(page.includes('id="dated-lines"') && page.includes("action={fixDatedLine}"), "rental page card");
const today = readFileSync("app/dashboard/page.tsx", "utf8");
assert.ok(today.includes("...datedLineCards") && today.includes("#dated-lines"), "Today card links to the fix");
n += 4;

console.log(`s830g dated lines: ${n} passed, 0 failed`);

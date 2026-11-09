// Run with: npx tsx scripts/test-coming-vacant.ts
// S770 (REVIEW-S770 section 6): the bridge from "tenant leaving" to one-click relist.
import { readFileSync } from "node:fs";
import { deriveComingVacant, relistPlan, showingHeadsUp } from "../lib/coming-vacant";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}
const base = {
  tenancyId: "t1",
  propertyId: "p1",
  address: "833 Pillette Rd, Unit 3",
  startDate: "2026-02-01",
  endDate: "2027-01-31",
  propertyStatus: "leased",
};
const today = "2026-11-10";

// 1. Nothing said: no card.
ok("no notice, no answer: nothing", deriveComingVacant({ ...base }, today) === null);
ok("staying: nothing", deriveComingVacant({ ...base, renewalIntent: "staying" }, today) === null);
ok("unsure: nothing", deriveComingVacant({ ...base, renewalIntent: "unsure" }, today) === null);

// 2. The tenant answered "leaving": vacant on the lease end.
const leaving = deriveComingVacant({ ...base, renewalIntent: "leaving" }, today);
ok("leaving -> coming vacant on the end date", leaving?.vacantDate === "2027-01-31" && leaving.source === "renewal_checkin");
ok("viewings open 21 days before", leaving?.viewingsFrom === "2027-01-10");
ok("not relisted yet", leaving?.relisted === false);
ok("Today's title names the unit and the day", leaving?.title === "833 Pillette Rd, Unit 3 is coming vacant on Jan 31.");
ok("Today's line says what the click does", leaving?.line === "Relist now: ads go up today, and viewings open from Jan 10.");
ok("days until vacant", leaving?.daysUntilVacant === 82);

// 3. No fixed end: move-in plus 12 months, as lib/renewal.
const monthly = deriveComingVacant({ ...base, endDate: null, renewalIntent: "leaving" }, today);
ok("no end date -> first-year completion", monthly?.vacantDate === "2027-02-01");

// 4. A recorded move-out date wins over the renewal answer.
const noticed = deriveComingVacant({ ...base, renewalIntent: "leaving", moveOutDate: "2026-12-15" }, today);
ok("move-out date wins", noticed?.vacantDate === "2026-12-15" && noticed.source === "move_out_date");
ok("viewings from Nov 24", noticed?.viewingsFrom === "2026-11-24");

// 5. Viewings never open in the past.
const soon = deriveComingVacant({ ...base, moveOutDate: "2026-11-20" }, today);
ok("a move-out in 10 days opens viewings today", soon?.viewingsFrom === today);

// 6. Already relisted with that date: the card says so and offers no second relist.
const done = deriveComingVacant(
  { ...base, moveOutDate: "2026-12-15", propertyStatus: "available", availableDate: "2026-12-15" },
  today,
);
ok("relisted reads as done", done?.relisted === true && /^Relisted\./.test(done.line));
const other = deriveComingVacant(
  { ...base, moveOutDate: "2026-12-15", propertyStatus: "available", availableDate: "2026-11-01" },
  today,
);
ok("live with another date is not this relist", other?.relisted === false);

// 7. Old history drops off; a recent past date still shows with past tense.
ok("a move-out 31 days ago is gone", deriveComingVacant({ ...base, moveOutDate: "2026-10-10" }, today) === null);
const past = deriveComingVacant({ ...base, moveOutDate: "2026-11-01" }, today);
ok("a move-out 9 days ago still shows, past tense", past?.title.includes("was due to be empty on Nov 1") === true);

// 8. Bad dates never throw.
ok("bad today", deriveComingVacant({ ...base, moveOutDate: "2026-12-15" }, "soon") === null);
ok("bad move-out ignored, no answer -> nothing", deriveComingVacant({ ...base, moveOutDate: "Dec 15" }, today) === null);

// 9. The click writes three fields.
const plan = relistPlan({ vacantDate: "2026-12-15", viewingsFrom: "2026-11-24" });
ok("relist plan", plan.status === "available" && plan.available_date === "2026-12-15" && plan.viewing_earliest_date === "2026-11-24");

// 10. The tenant heads-up.
const msg = showingHeadsUp({ address: "833 Pillette Rd, Unit 3", viewingsFrom: "2026-11-24", vacantDate: "2026-12-15", orgName: "Agile Real Estate Group" });
ok("heads-up subject", msg.subject === "Viewings at 833 Pillette Rd, Unit 3 from Nov 24");
ok("heads-up names the 24-hour rule", msg.body.includes("at least 24 hours before each viewing"));
ok("heads-up names the move-out day", msg.body.includes("Tuesday, December 15, 2026"));
ok("heads-up has no em dash", !msg.body.includes("—") && !msg.subject.includes("—"));

// 11. The pages read this rule.
const today_tsx = readFileSync("app/dashboard/page.tsx", "utf8");
ok("Today reads deriveComingVacant", today_tsx.includes("deriveComingVacant("));
ok("Today renders the card", today_tsx.includes("<ComingVacantCards"));
const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok("one action relists from the card", actions.includes("export async function relistComingVacant("));
ok("the action writes the relist plan", actions.includes("relistPlan("));
ok("the action posts to the sites after relisting", /relistComingVacant[\s\S]{0,2500}maybePrepareAvailableListing\(/.test(actions));
const tenancy = readFileSync("app/dashboard/tenancies/[id]/page.tsx", "utf8");
ok("the tenancy page records a move-out date", tenancy.includes("recordMoveOut") && tenancy.includes('name="move_out_date"'));
ok("the tenancy page says what the N forms do here", tenancy.includes("An N12 or N13 does not relist the unit"));
const comms = readFileSync("app/dashboard/tenancies/comms-actions.ts", "utf8");
ok("one click sends the showing heads-up", comms.includes("export async function sendShowingHeadsUp(") && comms.includes("showingHeadsUp("));
const lib = readFileSync("lib/coming-vacant.ts", "utf8");
ok("no em dashes in the rule", !lib.includes("—"));

console.log(`coming-vacant: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

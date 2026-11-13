// Run with: npx tsx scripts/test-unit-progress-reminders.ts
// S788d: the crew reminder cadence.
import { remindersDue, escalationsDue, emailFromContact, type UnitState, type CrewLite } from "../lib/unit-progress-reminders";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}
const tz = "America/Toronto";
const monday10 = new Date("2026-11-16T15:00:00Z"); // Mon 10:00 Toronto
const tuesday10 = new Date("2026-11-17T15:00:00Z");
const monday7 = new Date("2026-11-16T12:00:00Z"); // 7:00 Toronto
const day = 24 * 3600 * 1000;
const ago = (now: Date, d: number) => new Date(now.getTime() - d * day).toISOString();
const crew: CrewLite[] = [
  { id: "n", name: "Narayan", role: "manager", email: "n@x.ca" },
  { id: "a", name: "Aaliyah", role: "leasing", email: "a@x.ca" },
  { id: "x", name: "Xavier", role: "contractor", email: "x@x.ca" },
];
const unit = (o: Partial<UnitState>): UnitState => ({ id: "u1", address: "Unit 1", status: "available", stage: null, stageAt: null, stageDate: null, ...o });
const items = (r: ReturnType<typeof remindersDue>, id: string) => r.find((c) => c.crewId === id)?.items ?? [];

ok("nothing before 9 AM", remindersDue({ units: [unit({})], crew, sent: [], now: monday7, timeZone: tz }).length === 0);
ok("Monday: no stage yet goes to manager and leasing", items(remindersDue({ units: [unit({})], crew, sent: [], now: monday10, timeZone: tz }), "n").length === 1);
ok("Tuesday: no weekly check-in", remindersDue({ units: [unit({})], crew, sent: [], now: tuesday10, timeZone: tz }).length === 0);
ok("Monday: recent update is quiet", remindersDue({ units: [unit({ stage: "being_cleaned", stageAt: ago(monday10, 2) })], crew, sent: [], now: monday10, timeZone: tz }).every((c) => !c.items.some((i) => i.reason === "weekly_stale")));
ok("leased units skip the weekly check-in", remindersDue({ units: [unit({ status: "leased" })], crew, sent: [], now: monday10, timeZone: tz }).length === 0);
ok("on hold skips the weekly check-in", remindersDue({ units: [unit({ stage: "on_hold", stageAt: ago(monday10, 30) })], crew, sent: [], now: monday10, timeZone: tz }).length === 0);
ok("contractor: past ready-by", items(remindersDue({ units: [unit({ stage: "under_construction", stageAt: ago(tuesday10, 10), stageDate: "2026-11-15" })], crew, sent: [], now: tuesday10, timeZone: tz }), "x")[0]?.reason === "past_ready_by");
ok("contractor: ready-by today is not past", items(remindersDue({ units: [unit({ stage: "under_construction", stageAt: ago(tuesday10, 10), stageDate: "2026-11-17" })], crew, sent: [], now: tuesday10, timeZone: tz }), "x").length === 0);
ok("contractor: 5 days with no date", items(remindersDue({ units: [unit({ stage: "being_cleaned", stageAt: ago(tuesday10, 5) })], crew, sent: [], now: tuesday10, timeZone: tz }), "x")[0]?.reason === "reno_no_date");
ok("contractor: 4 days with no date is quiet", items(remindersDue({ units: [unit({ stage: "being_cleaned", stageAt: ago(tuesday10, 4) })], crew, sent: [], now: tuesday10, timeZone: tz }), "x").length === 0);
ok("deposit waiting 3 days goes to leasing only", (() => {
  const r = remindersDue({ units: [unit({ stage: "waiting_deposit", stageAt: ago(tuesday10, 3) })], crew, sent: [], now: tuesday10, timeZone: tz });
  return items(r, "a")[0]?.reason === "deposit_waiting" && items(r, "n").length === 0;
})());
ok("no leasing person: manager gets the deposit nudge", items(remindersDue({ units: [unit({ stage: "deposit_clearing", stageAt: ago(tuesday10, 2) })], crew: crew.filter((c) => c.role !== "leasing"), sent: [], now: tuesday10, timeZone: tz }), "n")[0]?.reason === "deposit_clearing");
ok("move-out in 5 days: book the handover", items(remindersDue({ units: [unit({ stage: "notice_given", stageAt: ago(tuesday10, 20), stageDate: "2026-11-22" })], crew, sent: [], now: tuesday10, timeZone: tz }), "n")[0]?.reason === "moveout_soon");
ok("move-out day passed: start the reno", items(remindersDue({ units: [unit({ stage: "notice_given", stageAt: ago(tuesday10, 40), stageDate: "2026-11-16" })], crew, sent: [], now: tuesday10, timeZone: tz }), "n")[0]?.reason === "moveout_today");
ok("one email a day per person", remindersDue({ units: [unit({ stage: "being_cleaned", stageAt: ago(tuesday10, 9) })], crew, sent: [{ crew_member_id: "x", property_id: "other", reason: "reno_no_date", sent_at: ago(tuesday10, 0.5) }], now: tuesday10, timeZone: tz }).length === 0);
ok("same reminder waits its repeat days", items(remindersDue({ units: [unit({ stage: "being_cleaned", stageAt: ago(tuesday10, 9) })], crew, sent: [{ crew_member_id: "x", property_id: "u1", reason: "reno_no_date", sent_at: ago(tuesday10, 3) }], now: tuesday10, timeZone: tz }), "x").length === 0);
ok("same reminder goes again after its repeat days", items(remindersDue({ units: [unit({ stage: "being_cleaned", stageAt: ago(tuesday10, 12) })], crew, sent: [{ crew_member_id: "x", property_id: "u1", reason: "reno_no_date", sent_at: ago(tuesday10, 5) }], now: tuesday10, timeZone: tz }), "x").length === 1);
ok("move-out reminder goes once", items(remindersDue({ units: [unit({ stage: "notice_given", stageAt: ago(tuesday10, 20), stageDate: "2026-11-22" })], crew, sent: [{ crew_member_id: "n", property_id: "u1", reason: "moveout_soon", sent_at: ago(tuesday10, 2) }], now: tuesday10, timeZone: tz }), "n").length === 0);
ok("no email address, no reminder", remindersDue({ units: [unit({})], crew: [{ id: "z", name: "Z", role: "manager", email: null }], sent: [], now: monday10, timeZone: tz }).length === 0);
ok("lines have no dashes", remindersDue({ units: [unit({})], crew, sent: [], now: monday10, timeZone: tz }).every((c) => c.items.every((i) => !/[–—]/.test(i.line))));

const row = (o: Partial<Parameters<typeof escalationsDue>[0][number]>) => ({ id: "r", crew_member_id: "x", property_id: "u1", reason: "reno_no_date", sent_at: ago(tuesday10, 4), escalated_at: null, ...o });
ok("escalate: 4 days, no change", escalationsDue([row({})], [unit({ stage: "being_cleaned", stageAt: ago(tuesday10, 12) })], tuesday10).length === 1);
ok("no escalation when the unit moved", escalationsDue([row({})], [unit({ stage: "photos_in", stageAt: ago(tuesday10, 1) })], tuesday10).length === 0);
ok("no escalation before 3 days", escalationsDue([row({ sent_at: ago(tuesday10, 2) })], [unit({ stage: "being_cleaned", stageAt: ago(tuesday10, 12) })], tuesday10).length === 0);
ok("no escalation twice", escalationsDue([row({ escalated_at: ago(tuesday10, 1) })], [unit({ stage: "being_cleaned", stageAt: ago(tuesday10, 12) })], tuesday10).length === 0);
ok("contact email parse", emailFromContact("xavier@agileonline.ca (Drive photos: shg157@gmail.com)") === "xavier@agileonline.ca" && emailFromContact("519-555-0000") === null);

console.log(`unit-progress-reminders: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

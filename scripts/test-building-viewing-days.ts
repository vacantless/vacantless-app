// S708/S709: viewing days per building. Run: npx tsx scripts/test-building-viewing-days.ts
import { readFileSync } from "node:fs";
import {
  buildingLabel,
  buildingOpenWeekdays,
  limitAvailabilityToWeekdays,
  parseBuildingWeekdays,
  unionBuildingWeekdays,
  type Availability,
} from "../lib/booking";
import { assessLeasingHealth, countOpenBookableSlots, openBookableDays } from "../lib/leasing-health";
import { reopenLeadsWithOpenBuilding } from "../lib/availability-reopen";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

ok("weekdays parsed, sorted, unique", JSON.stringify(parseBuildingWeekdays(["3", "2", "2"])) === "[2,3]");
ok("out-of-range and junk dropped", JSON.stringify(parseBuildingWeekdays(["7", "-1", "x", "", "0"])) === "[0]");
ok("no ticks -> empty (every day)", parseBuildingWeekdays([]).length === 0);
ok("label strips the unit", buildingLabel("833 Pillette Rd, Unit 3, Windsor, ON N8Y 3B4") === "833 Pillette Rd");
ok("label keeps a plain street", buildingLabel("1195 Bruce Ave, Unit 303, Windsor, ON") === "1195 Bruce Ave");

const mig = readFileSync("supabase/migrations/0237_availability_building_days.sql", "utf8");
ok("table has unique org+building+weekday", mig.includes("unique (organization_id, building_key, weekday)"));
ok("table granted to authenticated", mig.includes("to authenticated"));
ok("rules filtered by building days", mig.includes("or a.weekday in ("));
ok("specific dates filtered by building days", mig.includes("or extract(dow from v.day)::int in ("));
ok("booking guard inserted", mig.includes("S708: building viewing days") && mig.includes("b.weekday = v_dow"));
ok("booking guard refuses if the anchor moved", mig.includes("anchor not found; not modified"));
ok("no drop policy or revoke lines", !/drop policy|revoke /i.test(mig));

const page = readFileSync("app/dashboard/availability/page.tsx", "utf8");
ok("page renders the building section", page.includes("Viewing days by building") && page.includes("saveBuildingViewingDays"));
const actions = readFileSync("app/dashboard/availability/actions.ts", "utf8");
ok("save checks the building belongs to the org", actions.includes('.eq("building_key", buildingKey)') && actions.includes("building_invalid"));
ok("save is capability gated", /saveBuildingViewingDays[\s\S]{0,300}requireCapability\("manage_availability"/.test(actions));


// --- S709: the shared helper every calendar cron uses ----------------------
const rows = [
  { building_key: "bruce", weekday: 2 },
  { building_key: "pillette", weekday: 3 },
];
ok("building with rows -> its days", JSON.stringify(buildingOpenWeekdays("bruce", rows)) === "[2]");
ok("building without rows -> every day (null)", buildingOpenWeekdays("assumption", rows) === null);
ok("no building key -> every day (null)", buildingOpenWeekdays(null, rows) === null);
ok("union of limited buildings", JSON.stringify(unionBuildingWeekdays(["bruce", "pillette", "bruce"], rows)) === "[2,3]");
ok("union with one unlimited building -> no limit", unionBuildingWeekdays(["bruce", "assumption"], rows) === null);
ok("union with no listed buildings -> no limit", unionBuildingWeekdays([], rows) === null);

const av: Availability = {
  timezone: "America/Toronto",
  slot_minutes: 30,
  lead_hours: 0,
  horizon_days: 14,
  rules: [
    { weekday: 2, start_minute: 17 * 60, end_minute: 18 * 60 },
    { weekday: 4, start_minute: 17 * 60, end_minute: 18 * 60 },
  ],
  booked: [],
  days_off: [],
  // 2026-10-21 is a Wednesday, 2026-10-22 a Thursday.
  overrides: [
    { day: "2026-10-21", start_minute: 10 * 60, end_minute: 11 * 60 },
    { day: "2026-10-22", start_minute: 10 * 60, end_minute: 11 * 60 },
  ],
};
ok("null limit returns the calendar unchanged", limitAvailabilityToWeekdays(av, null) === av);
const tueOnly = limitAvailabilityToWeekdays(av, [2]);
ok("limit keeps only that weekday's windows", tueOnly.rules.length === 1 && tueOnly.rules[0].weekday === 2);
ok("limit drops specific dates on other weekdays", (tueOnly.overrides ?? []).length === 0);
const wedOnly = limitAvailabilityToWeekdays(av, [3]);
ok("limit keeps a specific date on an allowed weekday", (wedOnly.overrides ?? []).length === 1 && wedOnly.overrides![0].day === "2026-10-21");
ok("limit does not mutate the input", av.rules.length === 2 && (av.overrides ?? []).length === 2);

// Monday 2026-10-19 09:00 Toronto (13:00Z), 7-day window.
const now = new Date("2026-10-19T13:00:00Z");
const allDays = openBookableDays(av, now, 7);
const tueDays = openBookableDays(tueOnly, now, 7);
ok("full calendar opens Tue, Wed (date), Thu", allDays.join(",") === "2026-10-20,2026-10-21,2026-10-22");
ok("Bruce (Tue) opens only Tuesday", tueDays.join(",") === "2026-10-20");
ok("a building on a day with no window has 0 slots", countOpenBookableSlots(limitAvailabilityToWeekdays(av, [5]), now, 7) === 0);

// Reopened notify: only leads whose building has an open time.
type L = { id: string; b: string | null };
const leads: L[] = [
  { id: "bruce-lead", b: "bruce" },
  { id: "friday-lead", b: "fri" },
  { id: "plain-lead", b: null },
];
let calls = 0;
const kept = reopenLeadsWithOpenBuilding(
  leads,
  (l) => l.b,
  [...rows, { building_key: "fri", weekday: 5 }],
  (days) => {
    calls++;
    return countOpenBookableSlots(limitAvailabilityToWeekdays(av, days), now, 7);
  },
);
ok("reopen keeps leads whose building has open times", kept.map((l) => l.id).join(",") === "bruce-lead,plain-lead");
ok("reopen counts each distinct limit once", calls === 3);

// Snapshot: a listing whose building days have no open time gets its own line.
const health = assessLeasingHealth({
  now,
  windowDays: 7,
  availability: av,
  lastWindowChangeMs: null,
  listings: [
    { propertyId: "p-fri", address: "1 Fri St", status: "available", createdAtMs: null, openInquiries: 0, bookedInstants: [], buildingOpenDays: 0 },
    { propertyId: "p-ok", address: "2 Ok St", status: "available", createdAtMs: null, openInquiries: 0, bookedInstants: [] },
  ],
});
const offline = health.alerts.filter((a) => a.code === "offline").map((a) => a.propertyId);
ok("snapshot flags the listing with no open building day", offline.join(",") === "p-fri");

for (const cron of [
  "app/api/cron/viewing-reminder/route.ts",
  "app/api/cron/leasing-snapshot/route.ts",
  "app/api/cron/availability-tripwire/route.ts",
  "app/api/cron/availability-reopened-notify/route.ts",
]) {
  const src = readFileSync(cron, "utf8");
  ok(`${cron.split("/")[3]} reads building days through the shared helper`,
    src.includes("loadBuildingDayScope(admin") && src.includes("limitAvailabilityToWeekdays("));
}
const loader = readFileSync("lib/building-days-server.ts", "utf8");
ok("loader reads only available, unarchived units", loader.includes('.eq("status", "available")') && loader.includes('.is("archived_at", null)'));
ok("intro copy points to the building days box", page.includes("tick its days in"));

console.log(`\nbuilding-viewing-days: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

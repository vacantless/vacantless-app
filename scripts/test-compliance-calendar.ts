// Unit tests for the seasonal compliance-calendar pure scheduling logic (S343).
// Run: npx tsx scripts/test-compliance-calendar.ts
import {
  COMPLIANCE_CALENDAR_ITEMS,
  LANDLORD_CALENDAR_ITEMS,
  parseYmdUTC,
  anchorDateFor,
  dueComplianceItems,
  seasonalDedupeKey,
  complianceReminderDedupeKey,
  type ComplianceCalendarItem,
} from "../lib/compliance-calendar";
import { getNotificationEvent, notificationSendMode } from "../lib/notifications";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

function dueKeys(today: string): string[] {
  return dueComplianceItems(today)
    .map((d) => d.item.eventKey)
    .sort();
}

// --- parseYmdUTC --------------------------------------------------------------
ok("parseYmdUTC accepts a valid date", parseYmdUTC("2026-10-15") != null);
ok("parseYmdUTC rejects malformed", parseYmdUTC("2026-13-01") == null);
ok("parseYmdUTC rejects junk", parseYmdUTC("not-a-date") == null);
ok("parseYmdUTC rejects rollover (Feb 30)", parseYmdUTC("2026-02-30") == null);
ok("parseYmdUTC rejects empty", parseYmdUTC("") == null);

// --- anchorDateFor ------------------------------------------------------------
ok(
  "anchorDateFor zero-pads",
  anchorDateFor({ eventKey: "x", anchorMonth: 4, anchorDay: 5, leadDays: 1 }, 2026) === "2026-04-05",
);

// --- config integrity: every item points at a registered approve_to_send event
for (const item of COMPLIANCE_CALENDAR_ITEMS) {
  const ev = getNotificationEvent(item.eventKey);
  ok(`event registered: ${item.eventKey}`, ev != null);
  ok(`event is tenant audience: ${item.eventKey}`, ev?.audience === "tenant");
  ok(`event is approve_to_send: ${item.eventKey}`, ev != null && notificationSendMode(ev) === "approve_to_send");
  ok(`event is active: ${item.eventKey}`, ev?.active === true);
}

// --- config integrity: every LANDLORD item points at a registered operator/
// notify event (S357). The landlord tier emails the operator directly, so the
// event must be audience operator and sendMode notify (the registry default). --
for (const item of LANDLORD_CALENDAR_ITEMS) {
  const ev = getNotificationEvent(item.eventKey);
  ok(`landlord event registered: ${item.eventKey}`, ev != null);
  ok(`landlord event is operator audience: ${item.eventKey}`, ev?.audience === "operator");
  ok(`landlord event is notify mode: ${item.eventKey}`, ev != null && notificationSendMode(ev) === "notify");
  ok(`landlord event is active: ${item.eventKey}`, ev?.active === true);
}

// The two tiers must not share an event key (routed differently in the cron).
{
  const tenantKeys = new Set(COMPLIANCE_CALENDAR_ITEMS.map((i) => i.eventKey));
  ok(
    "tenant and landlord item sets are disjoint",
    LANDLORD_CALENDAR_ITEMS.every((i) => !tenantKeys.has(i.eventKey)),
  );
}

// --- dueComplianceItems: window open/closed ----------------------------------
// Furnace filter: anchor Oct 1, lead 14, grace 7 -> window [Sep 17, Oct 8].
ok("filter due on anchor", dueKeys("2026-10-01").includes("leasing.seasonal_furnace_filter"));
ok("filter due at window open (Sep 17)", dueKeys("2026-09-17").includes("leasing.seasonal_furnace_filter"));
ok("filter NOT due day before open (Sep 16)", !dueKeys("2026-09-16").includes("leasing.seasonal_furnace_filter"));
ok("filter due at grace close (Oct 8)", dueKeys("2026-10-08").includes("leasing.seasonal_furnace_filter"));
ok("filter NOT due day after grace (Oct 9)", !dueKeys("2026-10-09").includes("leasing.seasonal_furnace_filter"));

// Water shut-off: anchor Oct 20, lead 21, grace 7 -> [Sep 29, Oct 27].
ok("water-shutoff due in window (Oct 10)", dueKeys("2026-10-10").includes("leasing.seasonal_water_shutoff"));
ok("water-shutoff NOT due in Aug", !dueKeys("2026-08-15").includes("leasing.seasonal_water_shutoff"));

// Smoke/CO: anchor Nov 1, lead 14, grace 7 -> [Oct 18, Nov 8].
ok("smoke/CO due Oct 25", dueKeys("2026-10-25").includes("leasing.seasonal_smoke_co_test"));

// Water turn-on: anchor Apr 20, lead 21, grace 7 -> [Mar 30, Apr 27].
ok("water-turnon due Apr 10", dueKeys("2026-04-10").includes("leasing.seasonal_water_turnon"));
ok("water-turnon NOT due in Oct", !dueKeys("2026-10-10").includes("leasing.seasonal_water_turnon"));

// Dryer-vent: anchor Feb 1, lead 14, grace 14 -> [Jan 18, Feb 15].
ok("dryer-vent due on anchor (Feb 1)", dueKeys("2026-02-01").includes("leasing.seasonal_dryer_vent"));
ok("dryer-vent due at window open (Jan 18)", dueKeys("2026-01-18").includes("leasing.seasonal_dryer_vent"));
ok("dryer-vent NOT due day before open (Jan 17)", !dueKeys("2026-01-17").includes("leasing.seasonal_dryer_vent"));
ok("dryer-vent due at grace close (Feb 15)", dueKeys("2026-02-15").includes("leasing.seasonal_dryer_vent"));
ok("dryer-vent NOT due day after grace (Feb 16)", !dueKeys("2026-02-16").includes("leasing.seasonal_dryer_vent"));

// AC startup: anchor May 15, lead 14, grace 7 -> [May 1, May 22].
ok("ac-startup due in window (May 10)", dueKeys("2026-05-10").includes("leasing.seasonal_ac_startup"));
ok("ac-startup NOT due in Aug", !dueKeys("2026-08-15").includes("leasing.seasonal_ac_startup"));

// Eavestrough: anchor Nov 15, lead 14, grace 14 -> [Nov 1, Nov 29].
ok("eavestrough due Nov 20", dueKeys("2026-11-20").includes("leasing.seasonal_eavestrough"));
ok("eavestrough NOT due in Sep", !dueKeys("2026-09-20").includes("leasing.seasonal_eavestrough"));

// --- overlapping fall windows: multiple items can be due the same day --------
// Oct 1: filter [Sep17-Oct8] open AND water-shutoff [Sep29-Oct27] open.
ok(
  "Oct 1 has both filter and water-shutoff due",
  dueKeys("2026-10-01").includes("leasing.seasonal_furnace_filter") &&
    dueKeys("2026-10-01").includes("leasing.seasonal_water_shutoff"),
);

// --- a quiet day has nothing due ---------------------------------------------
ok("mid-summer (Jul 1) has nothing due", dueComplianceItems("2026-07-01").length === 0);
ok("mid-winter (Jan 15) has nothing due", dueComplianceItems("2026-01-15").length === 0);

// --- seasonYear resolves to the matched anchor's year ------------------------
{
  const due = dueComplianceItems("2026-10-01").find((d) => d.item.eventKey === "leasing.seasonal_furnace_filter");
  ok("seasonYear = 2026 for Oct 2026", due?.seasonYear === 2026);
  ok("anchorDate echoes the matched anchor", due?.anchorDate === "2026-10-01");
}

// --- malformed today returns nothing (cron-safe) -----------------------------
ok("malformed today -> empty", dueComplianceItems("garbage").length === 0);

// --- LANDLORD tier: dueComplianceItems(today, LANDLORD_CALENDAR_ITEMS) --------
function landlordKeys(today: string): string[] {
  return dueComplianceItems(today, LANDLORD_CALENDAR_ITEMS)
    .map((d) => d.item.eventKey)
    .sort();
}
// insurance review: anchor Jan 15, lead 14, grace 30 -> window [Jan 1, Feb 14].
ok("insurance review due on anchor", landlordKeys("2026-01-15").includes("leasing.landlord_insurance_review"));
ok("insurance review due in grace", landlordKeys("2026-02-10").includes("leasing.landlord_insurance_review"));
ok("insurance review not due after grace", !landlordKeys("2026-03-01").includes("leasing.landlord_insurance_review"));
// furnace service: anchor Sep 15, lead 21, grace 21 -> window [Aug 25, Oct 6].
ok("furnace service due on anchor", landlordKeys("2026-09-15").includes("leasing.landlord_furnace_service"));
// fire safety: anchor Oct 1, lead 21, grace 21 -> window [Sep 10, Oct 22].
ok("fire safety due on anchor", landlordKeys("2026-10-01").includes("leasing.landlord_fire_safety"));
// The default tenant call must NOT surface landlord items, and vice-versa.
ok("tenant call excludes landlord items", !dueKeys("2026-01-15").includes("leasing.landlord_insurance_review"));
ok("landlord call excludes tenant items", !landlordKeys("2026-10-01").includes("leasing.seasonal_furnace_filter"));
ok("landlord mid-summer (Jul 1) has nothing due", landlordKeys("2026-07-01").length === 0);

// --- complianceReminderDedupeKey: stable per season, distinct across years ----
ok("compliance reminder key shape", complianceReminderDedupeKey(2026) === "season:2026");
ok("compliance reminder key differs by year", complianceReminderDedupeKey(2026) !== complianceReminderDedupeKey(2027));

// --- seasonalDedupeKey: stable per (event, tenancy, year), distinct otherwise -
ok(
  "dedupe key stable",
  seasonalDedupeKey("leasing.seasonal_furnace_filter", "ten-1", 2026) ===
    "leasing.seasonal_furnace_filter:ten-1:2026",
);
ok(
  "dedupe key differs by year",
  seasonalDedupeKey("e", "t", 2026) !== seasonalDedupeKey("e", "t", 2027),
);
ok(
  "dedupe key differs by tenancy",
  seasonalDedupeKey("e", "t1", 2026) !== seasonalDedupeKey("e", "t2", 2026),
);
ok(
  "dedupe key differs by event",
  seasonalDedupeKey("e1", "t", 2026) !== seasonalDedupeKey("e2", "t", 2026),
);

console.log(`\ncompliance-calendar: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

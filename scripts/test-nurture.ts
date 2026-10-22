// Run with: npx tsx scripts/test-nurture.ts
import {
  nurtureStepDue,
  nurtureCopy,
  isNurturableStatus,
  isNurturablePropertyStatus,
  STEP_THRESHOLD_HOURS,
  NURTURE_STEPS,
  MIN_GAP_HOURS,
  NURTURE_MAX_AGE_MS,
  HOUR_MS,
  renterNurtureGate,
  onePerRenter,
  nurtureQuietNow,
  nurtureUsesNoTimeCopy,
} from "../lib/nurture";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name}\n  got  ${g}\n  want ${w}`);
  }
}

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0); // fixed "now"
const hoursAgo = (h: number) => NOW - h * HOUR_MS;

// Base input: a fresh-enough lead that has had nothing sent yet.
function base(overrides: Partial<Parameters<typeof nurtureStepDue>[0]> = {}) {
  return nurtureStepDue({
    createdAtMs: hoursAgo(STEP_THRESHOLD_HOURS[0] + 1), // just past step-1 threshold
    nowMs: NOW,
    status: "new",
    propertyStatus: "available",
    stepsSent: 0,
    lastSentAtMs: null,
    enabled: true,
    ...overrides,
  });
}

// --- isNurturableStatus ---
eq("status new nurturable", isNurturableStatus("new"), true);
eq("status replied nurturable", isNurturableStatus("replied"), true);
eq("status contacted nurturable", isNurturableStatus("contacted"), true);
eq("status booked NOT nurturable", isNurturableStatus("booked"), false);
eq("status showed NOT nurturable", isNurturableStatus("showed"), false);
eq("status applied NOT nurturable", isNurturableStatus("applied"), false);
eq("status leased NOT nurturable", isNurturableStatus("leased"), false);
eq("status lost NOT nurturable", isNurturableStatus("lost"), false);
eq("status null NOT nurturable", isNurturableStatus(null), false);

// --- isNurturablePropertyStatus ---
eq("property available nurturable", isNurturablePropertyStatus("available"), true);
eq("property leased NOT nurturable", isNurturablePropertyStatus("leased"), false);
eq("property draft NOT nurturable", isNurturablePropertyStatus("draft"), false);
eq("property off_market NOT nurturable", isNurturablePropertyStatus("off_market"), false);
eq("property null NOT nurturable", isNurturablePropertyStatus(null), false);

// --- property-status gate ---
eq("available property preserves due step", base({ propertyStatus: "available" }), 1);
eq("leased property stops drip", base({ propertyStatus: "leased" }), 0);
eq("draft property stops drip", base({ propertyStatus: "draft" }), 0);
eq("off_market property stops drip", base({ propertyStatus: "off_market" }), 0);
eq("null property status preserves current behavior", base({ propertyStatus: null }), 1);

// --- gating: enabled / status / completion ---
eq("disabled org → 0", base({ enabled: false }), 0);
eq("booked lead → 0", base({ status: "booked" }), 0);
eq("lost lead → 0", base({ status: "lost" }), 0);
eq("all steps sent → 0", base({ stepsSent: NURTURE_STEPS }), 0);
eq("more than all steps sent → 0", base({ stepsSent: NURTURE_STEPS + 5 }), 0);
eq("null createdAt → 0", base({ createdAtMs: null }), 0);

// --- step 1 cadence boundary ---
eq(
  "step1 just before threshold → 0",
  base({ createdAtMs: hoursAgo(STEP_THRESHOLD_HOURS[0] - 1) }),
  0,
);
eq(
  "step1 exactly at threshold → 1",
  base({ createdAtMs: hoursAgo(STEP_THRESHOLD_HOURS[0]) }),
  1,
);
eq("step1 well past threshold → 1", base(), 1);

// --- step 2: needs step1 already sent + its own threshold + pacing ---
eq(
  "step2 threshold passed, paced ok → 2",
  base({
    createdAtMs: hoursAgo(STEP_THRESHOLD_HOURS[1] + 1),
    stepsSent: 1,
    lastSentAtMs: hoursAgo(MIN_GAP_HOURS + 1),
  }),
  2,
);
eq(
  "step2 threshold not yet reached → 0",
  base({
    createdAtMs: hoursAgo(STEP_THRESHOLD_HOURS[1] - 5),
    stepsSent: 1,
    lastSentAtMs: hoursAgo(MIN_GAP_HOURS + 1),
  }),
  0,
);

// --- pacing: too soon since last send ---
eq(
  "paced: last send too recent → 0",
  base({
    createdAtMs: hoursAgo(STEP_THRESHOLD_HOURS[1] + 1),
    stepsSent: 1,
    lastSentAtMs: hoursAgo(MIN_GAP_HOURS - 1), // inside the gap
  }),
  0,
);
eq(
  "paced: last send exactly at gap → 2",
  base({
    createdAtMs: hoursAgo(STEP_THRESHOLD_HOURS[1] + 1),
    stepsSent: 1,
    lastSentAtMs: hoursAgo(MIN_GAP_HOURS),
  }),
  2,
);

// --- S726h: two steps only; nothing after step 2 ---
eq("two steps", NURTURE_STEPS, 2);
eq(
  "after step 2, nothing more even at day 10",
  base({
    createdAtMs: hoursAgo(10 * 24 + 1),
    stepsSent: 2,
    lastSentAtMs: hoursAgo(MIN_GAP_HOURS + 1),
  }),
  0,
);

// --- catch-up only advances ONE step at a time ---
// A very old-but-still-fresh lead with nothing sent should return step 1, not 3.
eq(
  "catch-up sends step1 first even if all thresholds passed",
  base({
    createdAtMs: hoursAgo(STEP_THRESHOLD_HOURS[1] + 1),
    stepsSent: 0,
    lastSentAtMs: null,
  }),
  1,
);

// --- freshness cap ---
const maxAgeHours = NURTURE_MAX_AGE_MS / HOUR_MS;
eq(
  "freshness: just inside cap → 1",
  base({ createdAtMs: hoursAgo(maxAgeHours - 1), stepsSent: 0, lastSentAtMs: null }),
  1,
);
eq(
  "freshness: just past cap → 0",
  base({ createdAtMs: hoursAgo(maxAgeHours + 1), stepsSent: 0, lastSentAtMs: null }),
  0,
);

// --- defensive: inquiry in the future ---
eq("future inquiry → 0", base({ createdAtMs: NOW + 5 * HOUR_MS }), 0);

// --- malformed stepsSent clamps to 0 (treats as step 1 if due) ---
eq("negative stepsSent treated as 0 → 1", base({ stepsSent: -3 }), 1);

// --- nurtureCopy ---
for (let s = 1; s <= NURTURE_STEPS; s++) {
  const c = nurtureCopy(s);
  eq(`copy step ${s} subject non-empty`, c.subject.length > 0, true);
  eq(`copy step ${s} lead non-empty`, c.lead.length > 0, true);
  eq(`copy step ${s} cta non-empty`, c.cta.length > 0, true);
}
eq("copy steps 1 and 2 differ", nurtureCopy(1).lead !== nurtureCopy(2).lead, true);
eq("copy out-of-range falls back to step 1", nurtureCopy(99).lead, nurtureCopy(1).lead);
eq("copy step 0 falls back to step 1", nurtureCopy(0).subject, nurtureCopy(1).subject);
eq(
  "copy no-suitable-time step 1 uses alternate viewing-time copy",
  nurtureCopy(1, true).lead.includes("lining up more viewing times"),
  true,
);
eq(
  "copy no-suitable-time differs from normal step 1",
  nurtureCopy(1, true).lead !== nurtureCopy(1).lead,
  true,
);
eq(
  "copy no-suitable-time avoids booking CTA",
  /book/i.test(nurtureCopy(1, true).cta),
  false,
);
eq(
  "copy no-suitable-time out-of-range falls back to flagged step 1",
  nurtureCopy(99, true).lead,
  nurtureCopy(1, true).lead,
);


// --- S726h: renterNurtureGate ---
{
  const sib = (id: string, status: string, hAgo: number, sentHAgo: number | null = null) => ({
    id, status, createdAtMs: hoursAgo(hAgo), lastSentAtMs: sentHAgo == null ? null : hoursAgo(sentHAgo),
  });
  eq("gate: only enquiry → ok", renterNurtureGate({ leadId: "a", nowMs: NOW, siblings: [sib("a", "new", 50)] }), "ok");
  eq("gate: older of two → newer_enquiry", renterNurtureGate({ leadId: "a", nowMs: NOW, siblings: [sib("a", "new", 100), sib("b", "new", 50)] }), "newer_enquiry");
  eq("gate: newer of two → ok", renterNurtureGate({ leadId: "b", nowMs: NOW, siblings: [sib("a", "new", 100), sib("b", "new", 50)] }), "ok");
  eq("gate: booked elsewhere → renter_advanced", renterNurtureGate({ leadId: "b", nowMs: NOW, siblings: [sib("a", "booked", 100), sib("b", "new", 50)] }), "renter_advanced");
  eq("gate: sibling emailed 3h ago → renter_recent_send", renterNurtureGate({ leadId: "b", nowMs: NOW, siblings: [sib("a", "lost", 100, 3), sib("b", "new", 50)] }), "renter_recent_send");
  eq("gate: sibling emailed 30h ago → ok", renterNurtureGate({ leadId: "b", nowMs: NOW, siblings: [sib("a", "lost", 100, 30), sib("b", "new", 50)] }), "ok");
  eq("gate: same time, larger id wins", [
    renterNurtureGate({ leadId: "a", nowMs: NOW, siblings: [sib("a", "new", 50), sib("b", "new", 50)] }),
    renterNurtureGate({ leadId: "b", nowMs: NOW, siblings: [sib("a", "new", 50), sib("b", "new", 50)] }),
  ], ["newer_enquiry", "ok"]);
}
// --- S726h: onePerRenter ---
{
  const r = (id: string, email: string | null, phone: string | null, iso: string) => ({ id, email, phone, created_at: iso });
  const out = onePerRenter([
    r("1", "Pat@X.com", null, "2026-10-01T00:00:00Z"),
    r("2", "pat@x.com ", null, "2026-10-05T00:00:00Z"),
    r("3", "pat@x.com", null, "2026-10-03T00:00:00Z"),
    r("4", null, "+1 (226) 555-0100", "2026-10-02T00:00:00Z"),
    r("5", null, "226-555-0100", "2026-10-04T00:00:00Z"),
    r("6", null, null, "2026-10-04T00:00:00Z"),
    r("7", "sam@x.com", null, "2026-10-04T00:00:00Z"),
  ]);
  eq("one per renter: send ids", out.send.map((x) => x.id).sort(), ["2", "5", "6", "7"]);
  eq("one per renter: 2 covers 3 and 1", (out.covered.get("2") ?? []).map((x) => x.id), ["3", "1"]);
  eq("one per renter: 5 covers 4", (out.covered.get("5") ?? []).map((x) => x.id), ["4"]);
  eq("one per renter: loner has no cover", out.covered.has("6"), false);
}
// --- S731: quiet hours and the no-time copy ---
{
  const toronto = (h: number, m = 0) => Date.UTC(2026, 9, 22, h + 4, m); // EDT = UTC-4
  eq("quiet: 12:30 am Toronto is quiet", nurtureQuietNow(toronto(0, 30), "America/Toronto"), true);
  eq("quiet: 7:59 am is quiet", nurtureQuietNow(toronto(7, 59), "America/Toronto"), true);
  eq("quiet: 8:00 am sends", nurtureQuietNow(toronto(8), "America/Toronto"), false);
  eq("quiet: 8:59 pm sends", nurtureQuietNow(toronto(20, 59), "America/Toronto"), false);
  eq("quiet: 9:00 pm is quiet", nurtureQuietNow(toronto(21), "America/Toronto"), true);
  eq("quiet: null tz falls back to Toronto", nurtureQuietNow(toronto(0, 30), null), true);
  eq("quiet: bad tz never blocks", nurtureQuietNow(toronto(0, 30), "Not/AZone"), false);
  eq("no-time copy: flag, never told", nurtureUsesNoTimeCopy(true, null), true);
  eq("no-time copy: flag, told new times", nurtureUsesNoTimeCopy(true, "2026-10-20T15:00:00Z"), false);
  eq("no-time copy: no flag", nurtureUsesNoTimeCopy(false, null), false);
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

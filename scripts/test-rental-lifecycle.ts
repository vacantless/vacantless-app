// Unit tests for the rental lifecycle rail (IA Step 4 slice 1, S278).
// Run: npx tsx scripts/test-rental-lifecycle.ts
import {
  deriveRentalLifecycle,
  lifecycleStepLabel,
  LIFECYCLE_STEPS,
  type LifecycleStep,
  type LifecycleStepState,
  type RentalLifecycleInput,
} from "../lib/rental-lifecycle";
import { type LeadStatus } from "../lib/pipeline";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const PID = "11111111-1111-1111-1111-111111111111";

// Convenience: build an input with sensible empties, override what a test needs.
function inp(over: Partial<RentalLifecycleInput> = {}): RentalLifecycleInput {
  return {
    propertyStatus: "draft",
    hasRent: false,
    // A set-up unit has beds+baths; default them so downstream-step tests
    // (which assume a fully set-up unit) stay valid. Setup-gap tests override.
    bedsSet: true,
    bathsSet: true,
    photoCount: 0,
    listingPostCount: 0,
    hasAvailability: false,
    leadStatuses: [],
    ...over,
  };
}

function stateOf(
  res: ReturnType<typeof deriveRentalLifecycle>,
  step: LifecycleStep,
): LifecycleStepState {
  return res.steps.find((s) => s.step === step)!.state;
}

// --- shape ------------------------------------------------------------------
const fresh = deriveRentalLifecycle(PID, inp());
ok("seven steps in order", fresh.steps.length === 7);
ok(
  "steps match LIFECYCLE_STEPS order",
  fresh.steps.every((s, i) => s.step === LIFECYCLE_STEPS[i]),
);
ok("totalCount is 7", fresh.totalCount === 7);
ok("labels resolve", lifecycleStepLabel("set_up") === "Set up");

// --- brand-new draft: nothing done, current = set_up ------------------------
ok("fresh draft -> currentStep set_up", fresh.currentStep === "set_up");
ok("fresh draft -> 0 completed", fresh.completedCount === 0);
ok("fresh draft -> set_up is current", stateOf(fresh, "set_up") === "current");
ok("fresh draft -> market is todo", stateOf(fresh, "market") === "todo");
ok(
  "fresh draft -> set_up detail prompts",
  fresh.steps[0].detail === "Add rent & details",
);

// --- rent entered, still draft: set_up done, market current -----------------
const setUp = deriveRentalLifecycle(PID, inp({ hasRent: true }));
ok("rent set -> set_up done", stateOf(setUp, "set_up") === "done");
ok("rent set -> market current", setUp.currentStep === "market");
ok("rent set -> 1 completed", setUp.completedCount === 1);
ok(
  "market detail when not live + no photos",
  setUp.steps[1].detail === "Add photos & go live",
);

// --- rent set but beds/baths missing: setup NOT done (matches share contract) -
// The public-share checklist REQUIRES beds+baths, so the rail must keep the
// operator on set_up rather than pointing them at Market/Live while the share
// checklist is still blocking (P2, Best-In-Class QA 2026-07-01).
const noBeds = deriveRentalLifecycle(PID, inp({ hasRent: true, bedsSet: false }));
ok("rent set, no beds -> set_up current", noBeds.currentStep === "set_up");
ok("rent set, no beds -> set_up not done", stateOf(noBeds, "set_up") === "current");
ok(
  "rent set, no beds -> set_up detail still prompts",
  noBeds.steps[0].detail === "Add rent & details",
);
const noBaths = deriveRentalLifecycle(PID, inp({ hasRent: true, bathsSet: false }));
ok("rent set, no baths -> set_up current", noBaths.currentStep === "set_up");
const bedsBathsRent = deriveRentalLifecycle(
  PID,
  inp({ hasRent: true, bedsSet: true, bathsSet: true }),
);
ok(
  "rent + beds + baths -> set_up done",
  stateOf(bedsBathsRent, "set_up") === "done",
);
ok(
  "rent + beds + baths -> set_up detail 'Details added'",
  bedsBathsRent.steps[0].detail === "Details added",
);
// Monotonicity: a live+photos unit reads set_up done even if beds/baths were
// never flagged here (demonstrable later progress implies setup).
const liveNoBeds = deriveRentalLifecycle(
  PID,
  inp({ hasRent: true, bedsSet: false, bathsSet: false, propertyStatus: "available", photoCount: 2 }),
);
ok(
  "live+photos overrides missing beds via monotonicity -> set_up done",
  stateOf(liveNoBeds, "set_up") === "done",
);

// --- live with photos: market done, inquiries current -----------------------
const live = deriveRentalLifecycle(
  PID,
  inp({ hasRent: true, propertyStatus: "available", photoCount: 5, listingPostCount: 2 }),
);
ok("live+photos -> market done", stateOf(live, "market") === "done");
ok("live+photos -> inquiries current", live.currentStep === "inquiries");
ok(
  "market detail summarizes Live · photos · posts",
  live.steps[1].detail === "Live · 5 photos · 2 posts",
);
ok(
  "inquiries detail empty-state",
  live.steps.find((s) => s.step === "inquiries")!.detail === "No inquiries yet",
);

// --- live but no photos: market NOT done ------------------------------------
const liveNoPhotos = deriveRentalLifecycle(
  PID,
  inp({ hasRent: true, propertyStatus: "available", photoCount: 0 }),
);
ok(
  "live without photos -> market current (not done)",
  liveNoPhotos.currentStep === "market",
);
ok(
  "live without photos -> market detail asks for photos (no 'publish' contradiction)",
  liveNoPhotos.steps[1].detail === "Live · add photos",
);

// --- inquiries in, no viewing yet -------------------------------------------
const inquired = deriveRentalLifecycle(
  PID,
  inp({
    hasRent: true,
    propertyStatus: "available",
    photoCount: 3,
    leadStatuses: ["new", "replied", "lost"],
  }),
);
ok("3 leads -> inquiries done", stateOf(inquired, "inquiries") === "done");
ok("3 leads -> viewings current", inquired.currentStep === "viewings");
ok(
  "inquiries detail counts all leads incl lost",
  inquired.steps.find((s) => s.step === "inquiries")!.detail === "3 inquiries",
);
ok(
  "viewings empty + no availability -> prompt to set times",
  inquired.steps.find((s) => s.step === "viewings")!.detail ===
    "Set viewing times to enable booking",
);

const inquiredAvail = deriveRentalLifecycle(
  PID,
  inp({
    hasRent: true,
    propertyStatus: "available",
    photoCount: 3,
    hasAvailability: true,
    leadStatuses: ["new"],
  }),
);
ok(
  "single inquiry -> singular wording",
  inquiredAvail.steps.find((s) => s.step === "inquiries")!.detail ===
    "1 inquiry",
);
ok(
  "viewings empty WITH availability -> 'No viewings booked yet'",
  inquiredAvail.steps.find((s) => s.step === "viewings")!.detail ===
    "No viewings booked yet",
);

// --- viewing booked ---------------------------------------------------------
const booked = deriveRentalLifecycle(
  PID,
  inp({
    hasRent: true,
    propertyStatus: "available",
    photoCount: 3,
    leadStatuses: ["new", "booked"],
  }),
);
ok("booked lead -> viewings done", stateOf(booked, "viewings") === "done");
ok("booked lead -> screen current", booked.currentStep === "screen");
ok(
  "viewings detail counts booked+",
  booked.steps.find((s) => s.step === "viewings")!.detail === "1 with a viewing",
);

// "showed" also counts toward viewings + beyond
const showed = deriveRentalLifecycle(
  PID,
  inp({
    hasRent: true,
    propertyStatus: "available",
    photoCount: 3,
    leadStatuses: ["showed"],
  }),
);
ok("showed -> viewings done", stateOf(showed, "viewings") === "done");
ok("showed -> screen current", showed.currentStep === "screen");

// --- application in ---------------------------------------------------------
const applied = deriveRentalLifecycle(
  PID,
  inp({
    hasRent: true,
    propertyStatus: "available",
    photoCount: 3,
    leadStatuses: ["booked", "applied"],
  }),
);
ok("applied lead -> screen done", stateOf(applied, "screen") === "done");
ok("applied lead -> lease current", applied.currentStep === "lease");
ok(
  "screen detail counts applications",
  applied.steps.find((s) => s.step === "screen")!.detail === "1 application",
);

// --- a leased lead but unit not yet marked leased ---------------------------
const leadLeased = deriveRentalLifecycle(
  PID,
  inp({
    hasRent: true,
    propertyStatus: "available",
    photoCount: 3,
    leadStatuses: ["applied", "leased"],
  }),
);
// A lead marked "leased" is NOT proof a lease exists — without an actual
// tenancy record, the Lease step is the frontier (a prompt to create the
// tenancy), not "done", and we never claim "Lease signed".
ok(
  "leased lead, no tenancy -> lease is current (not done)",
  stateOf(leadLeased, "lease") === "current",
);
ok(
  "leased lead, no tenancy -> lease is the frontier",
  leadLeased.currentStep === "lease",
);
ok(
  "lease detail when a lead is leased but no tenancy",
  leadLeased.steps.find((s) => s.step === "lease")!.detail ===
    "Ready to start tenancy",
);

// --- fully leased unit ------------------------------------------------------
const tenanted = deriveRentalLifecycle(
  PID,
  inp({
    hasRent: true,
    propertyStatus: "leased",
    photoCount: 3,
    leadStatuses: ["leased"],
  }),
);
ok("leased unit -> all 7 done", tenanted.completedCount === 7);
ok("leased unit -> currentStep null", tenanted.currentStep === null);
ok("leased unit -> tenanted done", stateOf(tenanted, "tenanted") === "done");
ok(
  "leased unit -> tenanted detail",
  tenanted.steps.find((s) => s.step === "tenanted")!.detail ===
    "Tenant in place",
);

// --- monotone backfill: out-of-order evidence -------------------------------
// A unit marked Leased but with NO rent set and NO leads must still read as
// fully done — you cannot be tenanted without having been set up.
const leasedNoRent = deriveRentalLifecycle(
  PID,
  inp({ propertyStatus: "leased", hasRent: false, photoCount: 0 }),
);
ok(
  "leased w/o rent -> set_up backfilled to done",
  stateOf(leasedNoRent, "set_up") === "done",
);
ok(
  "leased w/o rent -> all done, no current",
  leasedNoRent.completedCount === 7 && leasedNoRent.currentStep === null,
);

// --- exactly one 'current' step at any time ---------------------------------
function exactlyOneCurrent(res: ReturnType<typeof deriveRentalLifecycle>) {
  return res.steps.filter((s) => s.state === "current").length;
}
ok("fresh: exactly one current", exactlyOneCurrent(fresh) === 1);
ok("inquired: exactly one current", exactlyOneCurrent(inquired) === 1);
ok("applied: exactly one current", exactlyOneCurrent(applied) === 1);
ok("tenanted: zero current (all done)", exactlyOneCurrent(tenanted) === 0);

// done steps then current then todo — no 'todo' before a 'done'
function wellOrdered(res: ReturnType<typeof deriveRentalLifecycle>): boolean {
  let seenNonDone = false;
  for (const s of res.steps) {
    if (s.state === "done") {
      if (seenNonDone) return false; // a done after a non-done = gap
    } else {
      seenNonDone = true;
    }
  }
  return true;
}
ok("live: well-ordered (no done after a gap)", wellOrdered(live));
ok("booked: well-ordered", wellOrdered(booked));
ok("leadLeased: well-ordered", wellOrdered(leadLeased));

// --- hrefs ------------------------------------------------------------------
ok(
  "set_up href anchors to this rental's details",
  live.steps[0].href === `/dashboard/properties/${PID}#rental-details`,
);
ok(
  "market href anchors to photos",
  live.steps[1].href === `/dashboard/properties/${PID}#property-photos`,
);
ok(
  "inquiries href anchors to inquiries section",
  live.steps[2].href === `/dashboard/properties/${PID}#inquiries`,
);
ok(
  "screen href routes to screening surface when no applicants",
  live.steps.find((s) => s.step === "screen")!.href ===
    "/dashboard/leasing/screening",
);
ok(
  "screen href filters the inquiries list to this unit's applicants once an application is in",
  applied.steps.find((s) => s.step === "screen")!.href ===
    `/dashboard/leads?property=${PID}&status=applied`,
);
// Lease / Tenanted deep-links (S282, IA G8 fix). With no tenancy yet, the
// steps route to the "new tenancy" form pre-filled for this unit; with a
// tenancy, straight into it — never the cross-unit hub.
const TID = "22222222-2222-2222-2222-222222222222";
ok(
  "lease href -> new tenancy form for this unit when none exists",
  live.steps.find((s) => s.step === "lease")!.href ===
    `/dashboard/tenancies/new?property=${PID}`,
);
ok(
  "tenanted href -> new tenancy form for this unit when none exists",
  live.steps.find((s) => s.step === "tenanted")!.href ===
    `/dashboard/tenancies/new?property=${PID}`,
);
const withTenancy = deriveRentalLifecycle(
  PID,
  inp({
    propertyStatus: "leased",
    hasRent: true,
    photoCount: 1,
    leadStatuses: ["leased"],
    tenancyId: TID,
  }),
);
ok(
  "lease href -> this unit's tenancy when one exists",
  withTenancy.steps.find((s) => s.step === "lease")!.href ===
    `/dashboard/tenancies/${TID}`,
);
ok(
  "tenanted href -> this unit's tenancy when one exists",
  withTenancy.steps.find((s) => s.step === "tenanted")!.href ===
    `/dashboard/tenancies/${TID}`,
);

// --- REGRESSION (Codex QA, 2026-06-28): lifecycle truth ---------------------
// 18 Shorncliffe showed "Lease signed" + "Not tenanted yet" while an ACTIVE
// tenancy existed (unit still marked 'available', lead 'leased'). An active
// tenancy is the truth: the unit must read fully tenanted, never "not tenanted".
const activeTenancyAvailable = deriveRentalLifecycle(
  PID,
  inp({
    hasRent: true,
    propertyStatus: "available",
    photoCount: 3,
    leadStatuses: ["leased"],
    tenancyId: TID,
    tenancyStatus: "active",
  }),
);
ok(
  "active tenancy on available unit -> tenanted done",
  stateOf(activeTenancyAvailable, "tenanted") === "done",
);
ok(
  "active tenancy -> currentStep null (fully leased)",
  activeTenancyAvailable.currentStep === null,
);
ok(
  "active tenancy -> lease detail 'Lease done'",
  activeTenancyAvailable.steps.find((s) => s.step === "lease")!.detail ===
    "Lease done",
);
ok(
  "active tenancy -> tenanted detail 'Tenant in place'",
  activeTenancyAvailable.steps.find((s) => s.step === "tenanted")!.detail ===
    "Tenant in place",
);

// An UPCOMING tenancy: a lease exists (done) but the tenant is not in yet.
const upcomingTenancy = deriveRentalLifecycle(
  PID,
  inp({
    hasRent: true,
    propertyStatus: "available",
    photoCount: 3,
    leadStatuses: ["applied"],
    tenancyId: TID,
    tenancyStatus: "upcoming",
  }),
);
ok(
  "upcoming tenancy -> lease done",
  stateOf(upcomingTenancy, "lease") === "done",
);
ok(
  "upcoming tenancy -> tenanted is the frontier",
  upcomingTenancy.currentStep === "tenanted",
);
ok(
  "upcoming tenancy -> tenanted detail 'Tenancy starts soon'",
  upcomingTenancy.steps.find((s) => s.step === "tenanted")!.detail ===
    "Tenancy starts soon",
);
// --- REGRESSION (Codex re-review, S371): tenancy truth wins over status -------
// Creating a tenancy now flips the unit to `leased` (so the public/booking
// surfaces close). The rail must keep deriving tenanted-ness from the TENANCY,
// not the status shortcut: an UPCOMING tenancy on a now-`leased` unit must still
// read "Tenancy starts soon" with Tenanted as the frontier — NOT "Tenant in
// place"/done (the bug if isLeased short-circuited). Active stays "Tenant in place".
const upcomingTenancyLeased = deriveRentalLifecycle(
  PID,
  inp({
    hasRent: true,
    propertyStatus: "leased",
    photoCount: 3,
    leadStatuses: ["applied"],
    tenancyId: TID,
    tenancyStatus: "upcoming",
  }),
);
ok(
  "upcoming tenancy + leased status -> lease done",
  stateOf(upcomingTenancyLeased, "lease") === "done",
);
ok(
  "upcoming tenancy + leased status -> tenanted is the frontier (not done)",
  stateOf(upcomingTenancyLeased, "tenanted") !== "done" &&
    upcomingTenancyLeased.currentStep === "tenanted",
);
ok(
  "upcoming tenancy + leased status -> detail still 'Tenancy starts soon'",
  upcomingTenancyLeased.steps.find((s) => s.step === "tenanted")!.detail ===
    "Tenancy starts soon",
);
const activeTenancyLeased = deriveRentalLifecycle(
  PID,
  inp({
    hasRent: true,
    propertyStatus: "leased",
    photoCount: 3,
    leadStatuses: ["leased"],
    tenancyId: TID,
    tenancyStatus: "active",
  }),
);
ok(
  "active tenancy + leased status -> tenanted done, 'Tenant in place'",
  stateOf(activeTenancyLeased, "tenanted") === "done" &&
    activeTenancyLeased.steps.find((s) => s.step === "tenanted")!.detail ===
      "Tenant in place",
);

// An ENDED-only tenancy on a re-listed unit is NOT current progress: the rail
// derives from re-marketing state, and lease is not auto-"done".
const endedTenancy = deriveRentalLifecycle(
  PID,
  inp({
    hasRent: true,
    propertyStatus: "available",
    photoCount: 3,
    leadStatuses: ["new"],
    tenancyId: TID,
    tenancyStatus: "ended",
  }),
);
ok(
  "ended-only tenancy -> lease NOT done",
  stateOf(endedTenancy, "lease") !== "done",
);

// --- paused unit still counts as marketed -----------------------------------
const paused = deriveRentalLifecycle(
  PID,
  inp({ hasRent: true, propertyStatus: "paused", photoCount: 2 }),
);
ok(
  "paused + photos -> market done (was published)",
  stateOf(paused, "market") === "done",
);

// guard: an unknown lead status string doesn't crash the rank reduce
const weird = deriveRentalLifecycle(
  PID,
  inp({
    hasRent: true,
    propertyStatus: "available",
    photoCount: 1,
    leadStatuses: ["new", "definitely-not-a-status" as unknown as LeadStatus],
  }),
);
ok("unknown lead status tolerated", weird.steps.length === 7);

console.log(
  `\ntest-rental-lifecycle: ${passed} passed, ${failed} failed (${passed + failed} total)`,
);
if (failed > 0) process.exit(1);

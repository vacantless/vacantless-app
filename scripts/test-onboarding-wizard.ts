import { computeOnboardingState } from "../lib/onboarding-wizard";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const fresh = computeOnboardingState({
  hasProperty: false,
  hasLiveListing: false,
  hasTenancy: false,
  wizardEnabled: true,
  railStepDoneAt: null,
  dismissedAt: null,
});

ok("four wizard steps", fresh.steps.length === 4 && fresh.totalCount === 4);
ok("fresh org -> property next", fresh.nextIncompleteStep?.key === "property");
ok("fresh org card visible", fresh.shouldShowCard === true);
ok("fresh org incomplete", fresh.isComplete === false);
ok(
  "step order is property,get_online,tenancy,rent_rail",
  fresh.steps.map((step) => step.key).join(",") === "property,get_online,tenancy,rent_rail",
);
ok("get_online step is not optional and links to the wizard", fresh.steps[1].optional !== true && fresh.steps[1].href === "/dashboard/link-portals");
ok("get_online step names the free sites first", /free sites/.test(fresh.steps[1].description) && /Paid sites come after/.test(fresh.steps[1].description));
ok("tenancy and rent steps say they come after a tenant", fresh.steps[2].description.startsWith("After you find a tenant") && fresh.steps[3].description.startsWith("After you find a tenant"));

const withProperty = computeOnboardingState({
  hasProperty: true,
  hasLiveListing: false,
  hasTenancy: false,
  wizardEnabled: true,
  railStepDoneAt: null,
  dismissedAt: null,
});

ok("property added -> property complete", withProperty.steps[0].status === "complete");
ok("property added -> get_online next (not tenancy)", withProperty.nextIncompleteStep?.key === "get_online");
const withLiveAd = computeOnboardingState({
  hasProperty: true,
  hasLiveListing: true,
  hasTenancy: false,
  wizardEnabled: true,
  railStepDoneAt: null,
  dismissedAt: null,
});
ok("live ad -> get_online complete, tenancy next", withLiveAd.steps[1].status === "complete" && withLiveAd.nextIncompleteStep?.key === "tenancy");
ok("live ad -> two done", withLiveAd.completedCount === 2);
const tenanted = computeOnboardingState({
  hasProperty: true,
  hasLiveListing: false,
  hasTenancy: true,
  wizardEnabled: true,
  railStepDoneAt: null,
  dismissedAt: null,
});
ok("tenanted unit -> get_online complete without an ad (nothing to advertise)", tenanted.steps[1].status === "complete" && tenanted.nextIncompleteStep?.key === "rent_rail");
const dark = computeOnboardingState({
  hasProperty: true,
  hasLiveListing: false,
  hasTenancy: false,
  wizardEnabled: false,
  railStepDoneAt: null,
  dismissedAt: null,
});
ok("wizard dark -> get_online links to the Rentals list, never a dark route", dark.steps[1].href === "/dashboard/properties");
ok("property added -> one done", withProperty.completedCount === 1);

const railSkipped = computeOnboardingState({
  hasProperty: true,
  hasLiveListing: false,
  hasTenancy: false,
  wizardEnabled: true,
  railStepDoneAt: "2026-08-02T12:00:00.000Z",
  dismissedAt: null,
});

ok("rail skip marks rail done", railSkipped.steps[3].status === "complete");
ok("rail skip still leaves get_online next", railSkipped.nextIncompleteStep?.key === "get_online");
ok("rail skip counts done steps", railSkipped.completedCount === 2);

const allDone = computeOnboardingState({
  hasProperty: true,
  hasLiveListing: true,
  hasTenancy: true,
  wizardEnabled: true,
  railStepDoneAt: "2026-08-02T12:00:00.000Z",
  dismissedAt: null,
});

ok("all done -> complete", allDone.isComplete === true);
ok("all done -> no next step", allDone.nextIncompleteStep === null);
ok("all done -> card hidden", allDone.shouldShowCard === false);

const dismissed = computeOnboardingState({
  hasProperty: true,
  hasLiveListing: false,
  hasTenancy: false,
  wizardEnabled: true,
  railStepDoneAt: null,
  dismissedAt: "2026-08-02T12:00:00.000Z",
});

ok("dismissed -> not complete", dismissed.isComplete === false);
ok("dismissed -> card hidden", dismissed.shouldShowCard === false);
ok("dismissed keeps next step for route", dismissed.nextIncompleteStep?.key === "get_online");

console.log(`\nonboarding-wizard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

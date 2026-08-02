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
  hasTenancy: false,
  railStepDoneAt: null,
  dismissedAt: null,
});

ok("three wizard steps", fresh.steps.length === 3 && fresh.totalCount === 3);
ok("fresh org -> property next", fresh.nextIncompleteStep?.key === "property");
ok("fresh org card visible", fresh.shouldShowCard === true);
ok("fresh org incomplete", fresh.isComplete === false);
ok(
  "step order is property,tenancy,rent_rail",
  fresh.steps.map((step) => step.key).join(",") === "property,tenancy,rent_rail",
);

const withProperty = computeOnboardingState({
  hasProperty: true,
  hasTenancy: false,
  railStepDoneAt: null,
  dismissedAt: null,
});

ok("property added -> property complete", withProperty.steps[0].status === "complete");
ok("property added -> tenancy next", withProperty.nextIncompleteStep?.key === "tenancy");
ok("property added -> one done", withProperty.completedCount === 1);

const railSkipped = computeOnboardingState({
  hasProperty: true,
  hasTenancy: false,
  railStepDoneAt: "2026-08-02T12:00:00.000Z",
  dismissedAt: null,
});

ok("rail skip marks rail done", railSkipped.steps[2].status === "complete");
ok("rail skip still leaves tenancy next", railSkipped.nextIncompleteStep?.key === "tenancy");
ok("rail skip counts done steps", railSkipped.completedCount === 2);

const allDone = computeOnboardingState({
  hasProperty: true,
  hasTenancy: true,
  railStepDoneAt: "2026-08-02T12:00:00.000Z",
  dismissedAt: null,
});

ok("all done -> complete", allDone.isComplete === true);
ok("all done -> no next step", allDone.nextIncompleteStep === null);
ok("all done -> card hidden", allDone.shouldShowCard === false);

const dismissed = computeOnboardingState({
  hasProperty: true,
  hasTenancy: false,
  railStepDoneAt: null,
  dismissedAt: "2026-08-02T12:00:00.000Z",
});

ok("dismissed -> not complete", dismissed.isComplete === false);
ok("dismissed -> card hidden", dismissed.shouldShowCard === false);
ok("dismissed keeps next step for route", dismissed.nextIncompleteStep?.key === "tenancy");

console.log(`\nonboarding-wizard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

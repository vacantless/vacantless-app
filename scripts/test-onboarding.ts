// Unit tests for the pure launch-checklist logic.
// Run: npx tsx scripts/test-onboarding.ts
import {
  buildLaunchChecklist,
  isBrandingConfirmed,
  DEFAULT_BRAND_COLOR,
  type ChecklistInput,
} from "../lib/onboarding";

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

const EMPTY: ChecklistInput = {
  propertyCount: 0,
  availabilityWindowCount: 0,
  brandingConfirmed: false,
  leadCount: 0,
  subscriptionActive: false,
};

const ALL: ChecklistInput = {
  propertyCount: 3,
  availabilityWindowCount: 5,
  brandingConfirmed: true,
  leadCount: 12,
  subscriptionActive: true,
};

// --- Structure -------------------------------------------------------------
{
  const c = buildLaunchChecklist(EMPTY);
  ok("five steps", c.steps.length === 5 && c.totalCount === 5);
  ok("empty -> 0 complete", c.completedCount === 0);
  ok("empty -> not all complete", c.allComplete === false);
  ok(
    "step order is property,availability,branding,intake,golive",
    c.steps.map((s) => s.key).join(",") ===
      "property,availability,branding,intake,golive",
  );
}

// --- All complete ----------------------------------------------------------
{
  const c = buildLaunchChecklist(ALL);
  ok("all -> 5 complete", c.completedCount === 5);
  ok("all -> allComplete true", c.allComplete === true);
  ok("all -> no next step", c.nextStep === null);
  ok(
    "all -> every step complete",
    c.steps.every((s) => s.status === "complete"),
  );
}

// --- Exactly one "current" (the first incomplete) --------------------------
{
  const c = buildLaunchChecklist(EMPTY);
  const currents = c.steps.filter((s) => s.status === "current");
  ok("exactly one current when nothing done", currents.length === 1);
  ok("first incomplete is current", c.steps[0].status === "current");
  ok("nextStep is the property step", c.nextStep?.key === "property");
  ok(
    "rest are todo",
    c.steps.slice(1).every((s) => s.status === "todo"),
  );
}

// --- Current advances as earlier steps complete ----------------------------
{
  const c = buildLaunchChecklist({
    ...EMPTY,
    propertyCount: 1,
    availabilityWindowCount: 2,
  });
  ok("property complete", c.steps[0].status === "complete");
  ok("availability complete", c.steps[1].status === "complete");
  ok("branding is the new current", c.steps[2].status === "current");
  ok("nextStep advanced to branding", c.nextStep?.key === "branding");
  ok("completedCount is 2", c.completedCount === 2);
}

// --- A later step done while an earlier one is open stays NOT current ------
// (steps are independent signals; only the first gap is "current")
{
  const c = buildLaunchChecklist({
    ...EMPTY,
    subscriptionActive: true, // last step done, earlier ones not
  });
  ok("golive counts complete out of order", c.steps[4].status === "complete");
  ok("first gap still current", c.steps[0].status === "current");
  ok("completedCount counts the out-of-order one", c.completedCount === 1);
  ok("not all complete", c.allComplete === false);
}

// --- Each step carries href + cta ------------------------------------------
{
  const c = buildLaunchChecklist(EMPTY);
  ok(
    "every step has href + cta",
    c.steps.every((s) => s.href.startsWith("/dashboard/") && s.cta.length > 0),
  );
}

// --- Intake step deep-links to a property's public page when one exists -----
{
  const intakeOf = (c: ReturnType<typeof buildLaunchChecklist>) =>
    c.steps.find((s) => s.key === "intake")!;

  // No property yet → falls back to the Properties list, same-tab.
  const none = intakeOf(buildLaunchChecklist(EMPTY));
  ok("intake defaults to /dashboard/properties", none.href === "/dashboard/properties");
  ok("intake default opens same-tab", !none.newTab);

  // Property exists → deep-link to /r/[id] in a new tab with a clearer CTA.
  const withProp = intakeOf(
    buildLaunchChecklist({ ...EMPTY, propertyCount: 1, firstPropertyId: "prop-123" }),
  );
  ok("intake deep-links to /r/[id]", withProp.href === "/r/prop-123");
  ok("intake opens in a new tab", withProp.newTab === true);
  ok("intake CTA becomes Preview inquiry page", withProp.cta === "Preview inquiry page");

  // Empty/whitespace id is ignored (no deep-link).
  const blank = intakeOf(
    buildLaunchChecklist({ ...EMPTY, firstPropertyId: "" }),
  );
  ok("blank firstPropertyId is ignored", blank.href === "/dashboard/properties");
}

// --- isBrandingConfirmed ---------------------------------------------------
ok(
  "default color + no logo/reply = not confirmed",
  isBrandingConfirmed({
    brand_color: DEFAULT_BRAND_COLOR,
    logo_url: null,
    reply_to_email: null,
  }) === false,
);
ok(
  "null color + nothing = not confirmed",
  isBrandingConfirmed({
    brand_color: null,
    logo_url: null,
    reply_to_email: null,
  }) === false,
);
ok(
  "custom color = confirmed",
  isBrandingConfirmed({
    brand_color: "#0e8c8c",
    logo_url: null,
    reply_to_email: null,
  }) === true,
);
ok(
  "default color casing ignored",
  isBrandingConfirmed({
    brand_color: DEFAULT_BRAND_COLOR.toUpperCase(),
    logo_url: null,
    reply_to_email: null,
  }) === false,
);
ok(
  "logo set = confirmed",
  isBrandingConfirmed({
    brand_color: DEFAULT_BRAND_COLOR,
    logo_url: "https://example.com/logo.png",
    reply_to_email: null,
  }) === true,
);
ok(
  "reply-to set = confirmed",
  isBrandingConfirmed({
    brand_color: DEFAULT_BRAND_COLOR,
    logo_url: null,
    reply_to_email: "leasing@example.com",
  }) === true,
);

// --- Report ----------------------------------------------------------------
console.log(`\nonboarding: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

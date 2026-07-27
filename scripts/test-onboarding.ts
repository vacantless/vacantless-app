// Unit tests for the pure launch-checklist logic.
// Run: npx tsx scripts/test-onboarding.ts
import {
  buildLaunchChecklist,
  isReplyToConfigured,
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
  listingOnlineCount: 0,
  wizardEnabled: false,
  availabilityWindowCount: 0,
  replyToConfigured: false,
  leadCount: 0,
  subscriptionActive: false,
};

const ALL: ChecklistInput = {
  propertyCount: 3,
  listingOnlineCount: 2,
  wizardEnabled: false,
  availabilityWindowCount: 5,
  replyToConfigured: true,
  leadCount: 12,
  subscriptionActive: true,
};

// --- Structure -------------------------------------------------------------
{
  const c = buildLaunchChecklist(EMPTY);
  ok("six steps", c.steps.length === 6 && c.totalCount === 6);
  ok("empty -> 0 complete", c.completedCount === 0);
  ok("empty -> not all complete", c.allComplete === false);
  ok(
    "step order is property,getonline,availability,replyto,intake,golive",
    c.steps.map((s) => s.key).join(",") ===
      "property,getonline,availability,replyto,intake,golive",
  );
}

// --- All complete ----------------------------------------------------------
{
  const c = buildLaunchChecklist(ALL);
  ok("all -> 6 complete", c.completedCount === 6);
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

// --- Get-online is the next best action once a rental exists ---------------
// (a first-timer with a listing but nothing posted is pointed at getting online)
{
  const c = buildLaunchChecklist({ ...EMPTY, propertyCount: 1 });
  ok("property complete", c.steps[0].status === "complete");
  ok("get-online is the new current", c.steps[1].status === "current");
  ok("nextStep advanced to getonline", c.nextStep?.key === "getonline");
  ok("completedCount is 1", c.completedCount === 1);
}

// --- Current advances past get-online once a listing is live ---------------
{
  const c = buildLaunchChecklist({
    ...EMPTY,
    propertyCount: 1,
    listingOnlineCount: 1,
    availabilityWindowCount: 2,
  });
  ok("get-online complete", c.steps[1].status === "complete");
  ok("availability complete", c.steps[2].status === "complete");
  ok("reply-to is the new current", c.steps[3].status === "current");
  ok("nextStep advanced to reply-to", c.nextStep?.key === "replyto");
  ok("completedCount is 3", c.completedCount === 3);
}

// --- A later step done while an earlier one is open stays NOT current ------
// (steps are independent signals; only the first gap is "current")
{
  const c = buildLaunchChecklist({
    ...EMPTY,
    subscriptionActive: true, // last step done, earlier ones not
  });
  ok("golive counts complete out of order", c.steps[5].status === "complete");
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

// --- Get-online step routing (wizard-aware, honest either way) -------------
{
  const getOnlineOf = (c: ReturnType<typeof buildLaunchChecklist>) =>
    c.steps.find((s) => s.key === "getonline")!;

  // Wizard dark → Properties list (open a listing's Get online tab), same-tab.
  const dark = getOnlineOf(buildLaunchChecklist(EMPTY));
  ok("get-online defaults to /dashboard/properties", dark.href === "/dashboard/properties");
  ok("get-online CTA is Get online", dark.cta === "Get online");
  ok("get-online opens same-tab", !dark.newTab);

  // Wizard enabled → drives Stage 1 of the guided wizard.
  const live = getOnlineOf(buildLaunchChecklist({ ...EMPTY, wizardEnabled: true }));
  ok("get-online drives the wizard when enabled", live.href === "/dashboard/link-portals");

  // Done once a listing is actually live somewhere.
  const posted = getOnlineOf(
    buildLaunchChecklist({ ...EMPTY, propertyCount: 1, listingOnlineCount: 1 }),
  );
  ok("get-online completes on a live listing_post", posted.status === "complete");
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

// --- isReplyToConfigured ---------------------------------------------------
ok(
  "no reply-to = not configured",
  isReplyToConfigured({ reply_to_email: null }) === false,
);
ok(
  "empty reply-to = not configured",
  isReplyToConfigured({ reply_to_email: "" }) === false,
);
ok(
  "whitespace reply-to = not configured",
  isReplyToConfigured({ reply_to_email: "   " }) === false,
);
ok(
  "reply-to set = configured",
  isReplyToConfigured({ reply_to_email: "leasing@example.com" }) === true,
);

// --- Report ----------------------------------------------------------------
console.log(`\nonboarding: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

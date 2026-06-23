// Unit tests for the pure building-notices domain model.
// Run: npx tsx scripts/test-building-notices.ts
import {
  buildBuildingOptions,
  buildingLabelFor,
  composeNoticeBody,
  validateBuildingNoticeInput,
  buildingNoticeErrorMessage,
  planBuildingEmailDeliveries,
  isBuildingSendable,
  tallyBuildingDeliveries,
  SCHEDULED_WORK_TEMPLATE,
  composeNoticeFromWorkOrder,
  type PropertyRef,
  type BuildingTenancy,
} from "../lib/building-notices";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- buildBuildingOptions ---------------------------------------------------
const props: PropertyRef[] = [
  { id: "p1", address: "100 King St, Unit 1", building_key: "100 king st" },
  { id: "p2", address: "100 King St, Unit 2", building_key: "100 king st" },
  { id: "p3", address: "5 Bay Ave, Apt 3", building_key: "5 bay ave" },
  { id: "p4", address: "No key here", building_key: null },
];
const opts = buildBuildingOptions(props);
ok("options: distinct buildings only", opts.length === 2);
ok("options: skips null building_key", !opts.some((o) => o.label === "No key here"));
ok("options: sorted by label", opts[0].label < opts[1].label);
ok(
  "options: label is street (unit stripped)",
  opts.some((o) => o.buildingKey === "100 king st" && o.label === "100 King St"),
);
ok("buildingLabelFor: found", buildingLabelFor(opts, "5 bay ave") === "5 Bay Ave");
ok("buildingLabelFor: fallback to key", buildingLabelFor(opts, "unknown") === "unknown");

// --- composeNoticeBody ------------------------------------------------------
ok("compose: no impact -> body unchanged", composeNoticeBody("Hello", null) === "Hello");
ok("compose: blank impact -> body unchanged", composeNoticeBody("Hello", "   ") === "Hello");
ok(
  "compose: impact appended under heading",
  composeNoticeBody("Hello", "Power out 9-12") ===
    "Hello\n\nWhat to expect:\nPower out 9-12",
);
ok(
  "compose: strips em/en dashes (house style)",
  composeNoticeBody("Work — soon", "9—12") === "Work - soon\n\nWhat to expect:\n9-12",
);
ok("compose: trims body", composeNoticeBody("  Hi  ", null) === "Hi");

// --- validateBuildingNoticeInput --------------------------------------------
const good = validateBuildingNoticeInput({
  buildingKey: "100 king st",
  subject: "Notice",
  body: "Body text",
  recipientCount: 3,
});
ok("validate: good passes", good.ok === true);
ok(
  "validate: trims values",
  good.ok && good.value.buildingKey === "100 king st" && good.value.subject === "Notice",
);
ok(
  "validate: missing building",
  validateBuildingNoticeInput({ buildingKey: "", subject: "s", body: "b", recipientCount: 1 }).ok ===
    false,
);
ok(
  "validate: missing subject (email always needs one)",
  (() => {
    const r = validateBuildingNoticeInput({ buildingKey: "k", subject: "", body: "b", recipientCount: 1 });
    return !r.ok && r.code === "subject";
  })(),
);
ok(
  "validate: missing body",
  (() => {
    const r = validateBuildingNoticeInput({ buildingKey: "k", subject: "s", body: "  ", recipientCount: 1 });
    return !r.ok && r.code === "body";
  })(),
);
ok(
  "validate: zero recipients",
  (() => {
    const r = validateBuildingNoticeInput({ buildingKey: "k", subject: "s", body: "b", recipientCount: 0 });
    return !r.ok && r.code === "recipients";
  })(),
);

// --- error messages ---------------------------------------------------------
ok("error: building", buildingNoticeErrorMessage("building") === "Choose a building to notify.");
ok("error: undefined -> null", buildingNoticeErrorMessage(undefined) === null);
ok("error: unknown -> generic", !!buildingNoticeErrorMessage("zzz"));

// --- planBuildingEmailDeliveries + tally ------------------------------------
const tenancies: BuildingTenancy[] = [
  {
    tenancyId: "t1",
    propertyAddress: "100 King St, Unit 1",
    rentCents: 150000,
    tenants: [
      { id: "a", name: "Ann", email: "ann@x.com", phone: null },
      { id: "b", name: "Bob", email: null, phone: "519-000-0000" }, // no email -> skip
    ],
  },
  {
    tenancyId: "t2",
    propertyAddress: "100 King St, Unit 2",
    rentCents: 160000,
    tenants: [{ id: "c", name: "Cat", email: "cat@x.com", phone: null }],
  },
  {
    tenancyId: "t3",
    propertyAddress: "100 King St, Unit 3",
    rentCents: null,
    tenants: [], // empty tenancy -> contributes a tenancy but no recipients
  },
];
const plan = planBuildingEmailDeliveries(tenancies);
ok("plan: one delivery per tenant (3)", plan.length === 3);
ok(
  "plan: carries tenancy + address",
  plan.every((d) => d.tenancyId && (d.propertyAddress === null || typeof d.propertyAddress === "string")),
);
ok(
  "plan: no-email tenant skipped",
  plan.find((d) => d.tenantId === "b")?.skipReason === "no_email",
);
ok(
  "plan: emailable tenant sendable",
  isBuildingSendable(plan.find((d) => d.tenantId === "a")!),
);
ok(
  "plan: no-email tenant not sendable",
  !isBuildingSendable(plan.find((d) => d.tenantId === "b")!),
);

const tally = tallyBuildingDeliveries(plan);
ok("tally: tenancyCount counts only tenancies with recipients (2)", tally.tenancyCount === 2);
ok("tally: recipientCount = distinct tenants (3)", tally.recipientCount === 3);
ok("tally: sendable = 2", tally.sendable === 2);
ok("tally: skipped = 1", tally.skipped === 1);

// empty plan
const emptyTally = tallyBuildingDeliveries([]);
ok(
  "tally: empty plan all zero",
  emptyTally.tenancyCount === 0 &&
    emptyTally.recipientCount === 0 &&
    emptyTally.sendable === 0 &&
    emptyTally.skipped === 0,
);

// --- template ---------------------------------------------------------------
ok("template: has subject/body/impact", !!SCHEDULED_WORK_TEMPLATE.subject && !!SCHEDULED_WORK_TEMPLATE.body && !!SCHEDULED_WORK_TEMPLATE.impact);
ok(
  "template: body uses only real tokens",
  (SCHEDULED_WORK_TEMPLATE.body.match(/\{\{\s*([a-z_]+)\s*\}\}/gi) ?? []).every((m) =>
    ["{{first_name}}", "{{org_name}}", "{{property_address}}"].includes(m.replace(/\s/g, "")),
  ),
);
ok("template: no em/en dash in body", !/[‒–—―]/.test(SCHEDULED_WORK_TEMPLATE.body));

// --- composeNoticeFromWorkOrder ---------------------------------------------
const full = composeNoticeFromWorkOrder({
  title: "Main panel repair",
  description: "Replacing the building's main electrical panel.",
  category: "electrical",
  tradeName: "Power Traxx",
  expectedStart: "2026-07-02",
  expectedFinish: "2026-07-02",
});
ok("fromWO: category in subject", full.subject.includes("Scheduled electrical work"));
ok("fromWO: keeps property_address token in subject", full.subject.includes("{{property_address}}"));
ok("fromWO: date in subject", full.subject.includes("Jul 2, 2026"));
ok("fromWO: prefers description over title for What", full.body.includes("- What: Replacing the building's main electrical panel."));
ok("fromWO: trade name in Who line", full.body.includes("- Who's doing it: Power Traxx"));
ok("fromWO: when uses the expected window + time brackets", full.body.includes("- When: Jul 2, 2026, [start time] - [end time]"));
ok("fromWO: electrical impact hint", full.impact.toLowerCase().includes("power may be unavailable"));
ok("fromWO: body uses only real tokens",
  (full.body.match(/\{\{\s*([a-z_]+)\s*\}\}/gi) ?? []).every((m) =>
    ["{{first_name}}", "{{org_name}}", "{{property_address}}"].includes(m.replace(/\s/g, "")),
  ),
);
ok("fromWO: no em/en dash", !/[‒–—―]/.test(full.subject + full.body + full.impact));

// range window
const range = composeNoticeFromWorkOrder({
  title: "Roof work",
  category: "structural",
  expectedStart: "2026-07-02",
  expectedFinish: "2026-07-04",
});
ok("fromWO: range window rendered with hyphen", range.body.includes("- When: Jul 2, 2026 - Jul 4, 2026,"));
ok("fromWO: falls back to title for What when no description", range.body.includes("- What: Roof work"));
ok("fromWO: non-hinted category uses generic impact", range.impact === SCHEDULED_WORK_TEMPLATE.impact);

// scheduled_for fallback when no expected window
const sched = composeNoticeFromWorkOrder({ title: "X", category: "plumbing", scheduledFor: "2026-08-01" });
ok("fromWO: scheduled_for used when no expected window", sched.body.includes("- When: Aug 1, 2026,"));
ok("fromWO: plumbing impact hint", sched.impact.toLowerCase().includes("water may be shut off"));

// empty / general -> brackets + generic phrasing
const bare = composeNoticeFromWorkOrder({});
ok("fromWO: no category -> 'scheduled work'", bare.body.includes("about scheduled work in the building"));
ok("fromWO: no date -> [date] subject", bare.subject.includes("- [date]"));
ok("fromWO: no date -> bracketed When", bare.body.includes("- When: [date], [start time] - [end time]"));
ok("fromWO: no description/title -> bracketed What", bare.body.includes("- What: [brief description of the work]"));
ok("fromWO: no trade -> bracketed Who", bare.body.includes("- Who's doing it: [contractor / our team]"));
const general = composeNoticeFromWorkOrder({ category: "general", title: "T" });
ok("fromWO: 'general' treated as no category", general.body.includes("about scheduled work in the building"));

// ----------------------------------------------------------------------------
console.log(`building-notices: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

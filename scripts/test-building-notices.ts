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

// ----------------------------------------------------------------------------
console.log(`building-notices: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

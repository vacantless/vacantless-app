// Unit tests for the append-only tenancy rent adjustment resolver (S575d).
// Run: npx tsx scripts/test-rent-adjustments.ts
import { readFileSync } from "node:fs";
import {
  currentEffectiveRent,
  resolveRentReconciliation,
} from "../lib/rent-adjustments";
import { leaseTermShiftEnabled } from "../lib/rent-adjustments-server";
import { deriveRentIncrease } from "../lib/rent-increase";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function withLeaseTermShiftEnv(value: string | undefined, fn: () => boolean): boolean {
  const previous = process.env.LEASE_TERM_SHIFT_ENABLED;
  if (value === undefined) {
    delete process.env.LEASE_TERM_SHIFT_ENABLED;
  } else {
    process.env.LEASE_TERM_SHIFT_ENABLED = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.LEASE_TERM_SHIFT_ENABLED;
    } else {
      process.env.LEASE_TERM_SHIFT_ENABLED = previous;
    }
  }
}

const original = {
  effectiveDate: "2024-01-01",
  rentCents: 200000,
  createdAt: "2026-07-26T10:00:00.000Z",
  kind: "original",
};

// --- currentEffectiveRent ---------------------------------------------------
{
  const current = currentEffectiveRent([original]);
  ok("original-only -> original is current", current?.rentCents === 200000);
}
{
  const current = currentEffectiveRent([
    original,
    {
      effectiveDate: "2025-01-01",
      rentCents: 210000,
      createdAt: "2026-07-26T10:01:00.000Z",
      kind: "increase",
    },
  ]);
  ok("later confirmed row wins", current?.rentCents === 210000);
}
{
  const current = currentEffectiveRent([
    original,
    {
      effectiveDate: "2025-01-01",
      rentCents: 210000,
      createdAt: "2026-07-26T10:01:00.000Z",
      kind: "increase",
    },
    {
      effectiveDate: "2025-01-01",
      rentCents: 208000,
      createdAt: "2026-07-26T10:02:00.000Z",
      kind: "correction",
    },
  ]);
  ok("same effective date tie-breaks to newest correction", current?.rentCents === 208000);
  ok("correction row returned", current?.kind === "correction");
}

// --- required confirm gate --------------------------------------------------
{
  const result = resolveRentReconciliation({
    required: true,
    status: null,
    leaseStartDate: "2024-01-01",
    originalRentCents: 200000,
    currentRentCents: null,
    currentEffectiveDate: null,
  });
  ok(
    "required confirm blocks arm path without affirmative answer",
    !result.ok && result.code === "current_rent_confirm",
  );
}

// --- reconciliation rows ----------------------------------------------------
{
  const result = resolveRentReconciliation({
    required: true,
    status: "unchanged",
    leaseStartDate: "2024-01-01",
    originalRentCents: 200000,
    currentRentCents: null,
    currentEffectiveDate: null,
    originalSource: "landlord_confirm",
  });
  ok("unchanged resolves", result.ok === true);
  if (result.ok && result.reconciliation) {
    ok("unchanged seeds one original row", result.reconciliation.rows.length === 1);
    ok("unchanged current rent is original", result.reconciliation.currentRentCents === 200000);
    ok("unchanged leaves last increase null", result.reconciliation.lastIncreaseDate === null);
  }
}
{
  const result = resolveRentReconciliation({
    required: true,
    status: "changed",
    leaseStartDate: "2024-01-01",
    originalRentCents: 200000,
    currentRentCents: 215000,
    currentEffectiveDate: "2025-03-01",
    originalSource: "lease_ocr",
    optionalAdjustments: [
      {
        effectiveDate: "2024-06-01",
        rentCents: 206000,
        kind: "increase",
        note: "First annual increase",
      },
    ],
  });
  ok("changed resolves", result.ok === true);
  if (result.ok && result.reconciliation) {
    ok("changed seeds original + earlier + current", result.reconciliation.rows.length === 3);
    ok("changed current rent is confirmed current", result.reconciliation.currentRentCents === 215000);
    ok("changed last increase uses current effective date", result.reconciliation.lastIncreaseDate === "2025-03-01");
    ok("original row preserves OCR source", result.reconciliation.rows[0]?.source === "lease_ocr");
  }
}

// --- guideline math uses confirmed current ---------------------------------
{
  const current = currentEffectiveRent([
    original,
    {
      effectiveDate: "2025-03-01",
      rentCents: 215000,
      createdAt: "2026-07-26T10:03:00.000Z",
    },
  ]);
  const derived = current
    ? deriveRentIncrease(
        {
          startDate: "2024-01-01",
          lastIncreaseDate: current.effectiveDate,
          currentRentCents: current.rentCents,
          guideline: () => 2.1,
        },
        "2026-01-01",
      )
    : null;
  ok("derive uses later confirmed current rent", derived?.currentRentCents === 215000);
  ok("new rent compounds from confirmed current", derived?.newRentCents === Math.round(215000 * 1.021));
}

// --- dark flag gate ---------------------------------------------------------
ok(
  "lease term shift defaults off when env is unset",
  withLeaseTermShiftEnv(undefined, () => leaseTermShiftEnabled() === false),
);
ok(
  "lease term shift accepts true",
  withLeaseTermShiftEnv("true", () => leaseTermShiftEnabled() === true),
);
ok(
  "lease term shift accepts 1",
  withLeaseTermShiftEnv("1", () => leaseTermShiftEnabled() === true),
);
ok(
  "lease term shift rejects false",
  withLeaseTermShiftEnv("false", () => leaseTermShiftEnabled() === false),
);

const cronRoute = readFileSync("app/api/cron/rent-increase/route.ts", "utf8");
ok(
  "flag off avoids the cron ledger query before migration 0189",
  cronRoute.includes("leaseTermShiftOn && tenancyIds.length > 0"),
);
ok(
  "flag off keeps unconfirmed tenancies in the cron derive path",
  cronRoute.includes("if (leaseTermShiftOn && !confirmedRentTenancies.has(t.id))"),
);

const actionsRoute = readFileSync("app/dashboard/tenancies/actions.ts", "utf8");
const recordChunk = actionsRoute.slice(
  actionsRoute.indexOf("export async function recordRentIncrease"),
  actionsRoute.indexOf("// ===========================================================================\n// Update core tenancy fields"),
);
const serveChunk = actionsRoute.slice(
  actionsRoute.indexOf("export async function serveN1"),
  actionsRoute.indexOf("// fileN1Pdf"),
);
ok(
  "flag off skips recordRentIncrease unconfirmed redirect",
  recordChunk.includes("leaseTermShiftEnabled() && !(await hasConfirmedRentLedger(supabase, id))"),
);
ok(
  "flag off skips serveN1 unconfirmed redirect",
  serveChunk.includes("leaseTermShiftEnabled() && !(await hasConfirmedRentLedger(supabase, id))"),
);

const n1Route = readFileSync("app/dashboard/tenancies/[id]/n1/route.ts", "utf8");
ok(
  "flag off skips the N1 prefill unconfirmed 400",
  n1Route.indexOf("leaseTermShiftEnabled()") <
    n1Route.indexOf("Confirm the current rent before opening a pre-filled N1."),
);

const detailPage = readFileSync("app/dashboard/tenancies/[id]/page.tsx", "utf8");
ok(
  "flag off makes the detail page render the rent-increase card path",
  detailPage.includes("? await hasConfirmedRentLedger(supabase, t.id)") &&
    detailPage.includes(": true;") &&
    detailPage.includes("leaseTermShiftOn && rentIncreaseReady && !rentLedgerConfirmed"),
);

const watchPage = readFileSync("app/dashboard/tenancies/watch/page.tsx", "utf8");
ok(
  "flag off preserves watch flow last-increase input",
  watchPage.includes("!leaseTermShiftOn") &&
    watchPage.includes('name="last_rent_increase_date"'),
);

const newTenancyPage = readFileSync("app/dashboard/tenancies/new/page.tsx", "utf8");
ok(
  "flag off keeps new-tenancy reconciliation unmounted",
  newTenancyPage.includes("{leaseTermShiftOn && (") &&
    newTenancyPage.includes("<RentReconciliationFields"),
);

const overviewPage = readFileSync("app/dashboard/page.tsx", "utf8");
const gateSources = [
  cronRoute,
  actionsRoute,
  n1Route,
  detailPage,
  watchPage,
  newTenancyPage,
  overviewPage,
].join("\n");
ok(
  "LEASE_TERM_SHIFT_ENABLED env read stays centralized",
  !gateSources.includes("process.env.LEASE_TERM_SHIFT_ENABLED"),
);

console.log(
  `\ntest-rent-adjustments: ${passed} passed, ${failed} failed (${passed + failed} total)`,
);
if (failed > 0) process.exit(1);

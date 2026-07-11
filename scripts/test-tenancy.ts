// Unit tests for the pure tenancy domain model. Run: npx tsx scripts/test-tenancy.ts
import {
  TENANCY_STATUSES,
  MAX_TENANTS_PER_TENANCY,
  tenancyStatusLabel,
  isTenancyStatus,
  tenancyTakesUnitOffMarket,
  parseMoneyToCents,
  parseTermMonths,
  parseDateOrNull,
  buildTenantList,
  validateTenancyInput,
  tenancyErrorMessage,
  formatRentCents,
  newTenancyEmptyState,
  type TenantInput,
} from "../lib/tenancy";

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

// --- Status -----------------------------------------------------------------
ok("statuses are upcoming/active/ended", TENANCY_STATUSES.join(",") === "upcoming,active,ended");
ok("isTenancyStatus accepts known", TENANCY_STATUSES.every((s) => isTenancyStatus(s)));
ok("isTenancyStatus rejects unknown", !isTenancyStatus("evicted"));
ok("label active", tenancyStatusLabel("active") === "Active");
ok("label unknown passthrough", tenancyStatusLabel("zzz") === "zzz");

// --- Takes-unit-off-market gate (Codex re-review S371) -----------------------
// Creating a tenancy flips the rental to `leased` ONLY for a current/forthcoming
// tenancy. Recording a HISTORICAL (ended) tenancy on a marketed rental must NOT
// take it offline. Must stay in lockstep with migration 0089's backfill.
ok("active tenancy takes unit off-market", tenancyTakesUnitOffMarket("active") === true);
ok("upcoming tenancy takes unit off-market", tenancyTakesUnitOffMarket("upcoming") === true);
ok("ended tenancy does NOT flip the rental to leased", tenancyTakesUnitOffMarket("ended") === false);
ok("unknown status does NOT take unit off-market", tenancyTakesUnitOffMarket("evicted") === false);

// --- New-tenancy empty-state split -----------------------------------------
ok("new tenancy empty: eligible rentals -> none", newTenancyEmptyState(2, 1) === null);
ok("new tenancy empty: no rentals", newTenancyEmptyState(0, 0) === "no_rentals");
ok(
  "new tenancy empty: rentals exist but none eligible",
  newTenancyEmptyState(2, 0) === "no_eligible_rentals",
);

// --- parseMoneyToCents ------------------------------------------------------
ok("money plain", parseMoneyToCents("1250") === 125000);
ok("money decimals", parseMoneyToCents("1250.50") === 125050);
ok("decimal rent persists exact cents", parseMoneyToCents("4018.33") === 401833);
ok("money with $ and comma", parseMoneyToCents("$1,250") === 125000);
ok("money blank -> null", parseMoneyToCents("") === null);
ok("money null -> null", parseMoneyToCents(null) === null);
ok("money negative -> null", parseMoneyToCents("-5") === null);
ok("money rounds to cents", parseMoneyToCents("10.005") === 1001 || parseMoneyToCents("10.005") === 1000);

// --- parseTermMonths --------------------------------------------------------
ok("term 12", parseTermMonths("12") === 12);
ok("term blank -> null (month-to-month)", parseTermMonths("") === null);
ok("term zero -> null", parseTermMonths("0") === null);
ok("term negative -> null", parseTermMonths("-3") === null);
ok("term floors decimals", parseTermMonths("6.9") === 6);

// --- parseDateOrNull --------------------------------------------------------
ok("date valid", parseDateOrNull("2026-07-01") === "2026-07-01");
ok("date blank -> null", parseDateOrNull("") === null);
ok("date malformed -> null", parseDateOrNull("07/01/2026") === null);

// --- buildTenantList --------------------------------------------------------
const single = buildTenantList({
  names: ["Alex Tenant"],
  emails: ["alex@example.com"],
  phones: ["555-1000"],
  primaryIndex: 0,
});
ok("single tenant kept", single.length === 1);
ok("single tenant is primary", single[0].is_primary === true);
ok("single tenant fields", single[0].name === "Alex Tenant" && single[0].email === "alex@example.com");

const co = buildTenantList({
  names: ["Alex", "Robin"],
  emails: ["", ""],
  phones: ["", ""],
  primaryIndex: 1,
});
ok("two co-tenants kept", co.length === 2);
ok("chosen primaryIndex honored", co[1].is_primary === true && co[0].is_primary === false);
ok("exactly one primary", co.filter((t) => t.is_primary).length === 1);

const withEmpties = buildTenantList({
  names: ["", "Robin", ""],
  emails: ["", "", ""],
  phones: ["", "", ""],
  primaryIndex: 1,
});
ok("empty rows dropped", withEmpties.length === 1 && withEmpties[0].name === "Robin");
ok("primary preserved after drop", withEmpties[0].is_primary === true);

const primaryDropped = buildTenantList({
  names: ["Alex", ""],
  emails: ["", ""],
  phones: ["", ""],
  primaryIndex: 1, // points at the dropped empty row
});
ok("primaryIndex on dropped row -> falls back to first", primaryDropped[0].is_primary === true);

const capped = buildTenantList({
  names: ["A", "B", "C", "D"],
  emails: ["", "", "", ""],
  phones: ["", "", "", ""],
  primaryIndex: 0,
});
ok("caps at MAX_TENANTS_PER_TENANCY", capped.length === MAX_TENANTS_PER_TENANCY);

const none = buildTenantList({ names: ["", ""], emails: ["", ""], phones: ["", ""], primaryIndex: 0 });
ok("all empty -> []", none.length === 0);

const phoneOnly = buildTenantList({ names: [""], emails: [""], phones: ["555-9"], primaryIndex: 0 });
ok("phone-only row survives", phoneOnly.length === 1 && phoneOnly[0].name === null);

// --- validateTenancyInput ---------------------------------------------------
const goodTenant: TenantInput = { name: "Alex", email: null, phone: null, is_primary: true };
ok(
  "valid input ok",
  validateTenancyInput({
    propertyId: "p1",
    startDate: "2026-07-01",
    endDate: "2027-06-30",
    tenants: [goodTenant],
  }).ok === true,
);
ok(
  "missing property -> property",
  matchCode(validateTenancyInput({ propertyId: null, startDate: "2026-07-01", endDate: null, tenants: [goodTenant] }), "property"),
);
ok(
  "missing start -> start",
  matchCode(validateTenancyInput({ propertyId: "p1", startDate: null, endDate: null, tenants: [goodTenant] }), "start"),
);
ok(
  "end before start -> dates",
  matchCode(
    validateTenancyInput({ propertyId: "p1", startDate: "2026-07-01", endDate: "2026-06-01", tenants: [goodTenant] }),
    "dates",
  ),
);
ok(
  "no named tenant -> tenant",
  matchCode(
    validateTenancyInput({
      propertyId: "p1",
      startDate: "2026-07-01",
      endDate: null,
      tenants: [{ name: null, email: "x@y.com", phone: null, is_primary: true }],
    }),
    "tenant",
  ),
);
ok(
  "equal start/end ok",
  validateTenancyInput({ propertyId: "p1", startDate: "2026-07-01", endDate: "2026-07-01", tenants: [goodTenant] }).ok ===
    true,
);

// --- tenancyErrorMessage + formatRentCents ----------------------------------
ok("error message known", tenancyErrorMessage("start") === "A lease start date is required.");
ok("error message unknown -> generic", tenancyErrorMessage("weird")!.length > 0);
ok("error message undefined -> null", tenancyErrorMessage(undefined) === null);
ok("formatRentCents", formatRentCents(125000) === "$1,250");
ok("formatRentCents null -> dash", formatRentCents(null) === "—");

function matchCode(v: { ok: boolean; code?: string }, code: string): boolean {
  return v.ok === false && v.code === code;
}

console.log(`\ntenancy: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

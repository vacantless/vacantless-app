// Unit tests for the "Watch a lease" entry validation (compliance-wedge Slice 2, S340).
// Run: npx tsx scripts/test-watch-lease.ts
import {
  validateWatchLeaseInput,
  validateWatchExistingLease,
  watchLeaseErrorMessage,
} from "../lib/watch-lease";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

function inp(over: Partial<Parameters<typeof validateWatchLeaseInput>[0]> = {}) {
  return {
    address: "833 Pillette Rd, Unit 20",
    startDate: "2024-07-01",
    lastIncreaseDate: null,
    primaryTenantName: "Jordan Tenant",
    ...over,
  };
}

// --- happy path -------------------------------------------------------------
ok("valid minimal input -> ok", validateWatchLeaseInput(inp()).ok === true);
ok(
  "valid with last-increase after start -> ok",
  validateWatchLeaseInput(inp({ lastIncreaseDate: "2025-07-01" })).ok === true,
);

// --- required fields --------------------------------------------------------
{
  const r = validateWatchLeaseInput(inp({ address: "" }));
  ok("missing address -> address", !r.ok && r.code === "address");
}
{
  const r = validateWatchLeaseInput(inp({ address: "   " }));
  ok("whitespace address -> address", !r.ok && r.code === "address");
}
{
  const r = validateWatchLeaseInput(inp({ startDate: null }));
  ok("missing start -> start", !r.ok && r.code === "start");
}
{
  const r = validateWatchLeaseInput(inp({ primaryTenantName: "" }));
  ok("missing tenant name -> tenant", !r.ok && r.code === "tenant");
}

// --- the rent-increase-specific date rule -----------------------------------
{
  const r = validateWatchLeaseInput(
    inp({ startDate: "2024-07-01", lastIncreaseDate: "2024-01-01" }),
  );
  ok(
    "last increase before start -> increase_before_start",
    !r.ok && r.code === "increase_before_start",
  );
}
{
  const r = validateWatchLeaseInput(
    inp({ startDate: "2024-07-01", lastIncreaseDate: "2024-07-01" }),
  );
  ok("last increase == start -> ok (not before)", r.ok === true);
}

// --- existing-tenancy (confirm/prefill) mode --------------------------------
// No address/tenant requirement (the record already holds them); only the
// start + date-order rules apply.
ok(
  "existing: start + no last increase -> ok",
  validateWatchExistingLease({ startDate: "2024-07-01", lastIncreaseDate: null }).ok === true,
);
ok(
  "existing: last increase after start -> ok",
  validateWatchExistingLease({ startDate: "2024-07-01", lastIncreaseDate: "2025-07-01" }).ok ===
    true,
);
{
  const r = validateWatchExistingLease({ startDate: null, lastIncreaseDate: null });
  ok("existing: missing start -> start", !r.ok && r.code === "start");
}
{
  const r = validateWatchExistingLease({
    startDate: "2024-07-01",
    lastIncreaseDate: "2024-01-01",
  });
  ok(
    "existing: last increase before start -> increase_before_start",
    !r.ok && r.code === "increase_before_start",
  );
}
ok(
  "existing: last increase == start -> ok (not before)",
  validateWatchExistingLease({ startDate: "2024-07-01", lastIncreaseDate: "2024-07-01" }).ok ===
    true,
);

// --- error messages ---------------------------------------------------------
ok("message: address", watchLeaseErrorMessage("address") === "Enter the unit's address.");
ok("message: notfound non-null", !!watchLeaseErrorMessage("notfound"));
ok("message: increase_before_start non-null", !!watchLeaseErrorMessage("increase_before_start"));
ok("message: unknown code -> generic", !!watchLeaseErrorMessage("nope"));
ok("message: undefined -> null", watchLeaseErrorMessage(undefined) === null);

console.log(
  `\ntest-watch-lease: ${passed} passed, ${failed} failed (${passed + failed} total)`,
);
if (failed > 0) process.exit(1);

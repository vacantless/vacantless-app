// Unit tests for n1ModelFromSnapshot (S460b, Codex P1 fold).
// Run: npx tsx scripts/test-n1-snapshot.ts
import { n1ModelFromSnapshot, type N1Snapshot } from "../lib/n1-render";
import { deriveRentIncrease } from "../lib/rent-increase";

let passed = 0, failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}`); }
}

const snap: N1Snapshot = {
  currentRentCents: 200000,
  newRentCents: 204200,
  increaseCents: 4200,
  currentRent: "$2,000",
  newRent: "$2,042",
  increaseAmount: "$42",
  guidelinePercent: 2.1,
  effectiveDate: "2027-03-01",
  serveByDate: "2026-12-01",
  exempt: false,
  landlordName: "Agile Real Estate Group",
  landlordPhone: "519-915-8865",
  landlordEmail: "rentals@example.com",
  tenantNames: ["Jane Tenant", "John Tenant"],
  rentalUnitAddress: "123 Pillette Rd, Unit 20",
  capturedAtIso: "2026-12-01T12:00:00.000Z",
};

const m = n1ModelFromSnapshot(snap);
ok("landlordName frozen", m.landlordName === "Agile Real Estate Group");
ok("currentRent frozen (formatted)", m.currentRent === "$2,000");
ok("newRent frozen (formatted)", m.newRent === "$2,042");
ok("increaseAmount frozen", m.increaseAmount === "$42");
ok("guideline frozen", m.guidelinePercent === 2.1);
ok("effectiveDate frozen", m.effectiveDate === "2027-03-01");
ok("serveByDate frozen", m.serveByDate === "2026-12-01");
ok("exempt frozen", m.exempt === false);
ok("tenantNames frozen", m.tenantNames.length === 2 && m.tenantNames[0] === "Jane Tenant");
ok("address frozen", m.rentalUnitAddress === "123 Pillette Rd, Unit 20");
ok("generatedAt = capturedAt", m.generatedAtIso === "2026-12-01T12:00:00.000Z");

// exempt snapshot: null amounts survive
const exemptSnap: N1Snapshot = { ...snap, exempt: true, newRentCents: null, newRent: null, increaseCents: null, increaseAmount: null, guidelinePercent: null };
const em = n1ModelFromSnapshot(exemptSnap);
ok("exempt: newRent null", em.newRent === null);
ok("exempt: increase null", em.increaseAmount === null);
ok("exempt: guideline null", em.guidelinePercent === null);
ok("exempt: flag true", em.exempt === true);

// defensive: non-array tenantNames -> []
const badSnap = { ...snap, tenantNames: undefined as unknown as string[] };
ok("bad tenantNames -> []", n1ModelFromSnapshot(badSnap).tenantNames.length === 0);

// --- S460c regression: the served snapshot MUST anchor on last_rent_increase_date
// (not the lease start) on later annual cycles - serveN1 derives the same way the
// dashboard card does. Omitting lastIncreaseDate froze a wrong effective date/amount
// that Stripe then billed from. ---------------------------------------------------
{
  const start = "2024-03-01";
  const lastIncrease = "2026-03-01"; // a prior increase two years after move-in
  const today = "2026-06-01";
  const withAnchor = deriveRentIncrease(
    { startDate: start, currentRentCents: 200000, lastIncreaseDate: lastIncrease },
    today,
  )!;
  const withoutAnchor = deriveRentIncrease(
    { startDate: start, currentRentCents: 200000, lastIncreaseDate: null },
    today,
  )!;
  ok("anchor: eligible = lastIncrease + 12mo", withAnchor.earliestEffectiveDate === "2027-03-01");
  ok("no-anchor would wrongly use start + 12mo", withoutAnchor.earliestEffectiveDate === "2025-03-01");
  ok("the two derivations DIFFER (why the snapshot needs lastIncreaseDate)",
     withAnchor.earliestEffectiveDate !== withoutAnchor.earliestEffectiveDate);
}

console.log(`\nn1-snapshot: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

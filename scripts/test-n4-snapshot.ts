// Unit tests for the pure N4 snapshot builder (Slice C). Run:
//   npx tsx scripts/test-n4-snapshot.ts
import {
  buildN4Snapshot,
  n4SnapshotBlocker,
  n4SnapshotReady,
  snapshotToN4Fill,
} from "@/lib/n4-snapshot";
import type { PaymentRow } from "@/lib/payments";

let pass = 0;
let fail = 0;
function eq(got: unknown, want: unknown, msg: string): void {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.error(`FAIL: ${msg} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
function ok(cond: boolean, msg: string): void {
  if (cond) pass++;
  else {
    fail++;
    console.error("FAIL:", msg);
  }
}

const RENT = 220000;
const base = {
  landlordName: "Agile Real Estate Group",
  landlordPhone: "519-555-0100",
  rentalUnitAddress: "123 Example St, Unit 4, Windsor, ON N9A 1A1",
  tenantNames: ["Liang Wu"],
  signer: { firstName: "Noam", lastName: "Muscovitch", dayPhone: "519-555-0132" },
  rentCents: RENT,
  startDateISO: "2026-05-01",
  formVersion: "v.01/04/2022",
  capturedAtIso: "2026-07-13T00:00:00Z",
};

// (a) Clean 3-month arrears, no payments -> reconciles, ready to fill.
{
  const snap = buildN4Snapshot({ ...base, noticeDateISO: "2026-07-13", payments: [] });
  eq(snap.computedOwingCents, 3 * RENT, "3 unpaid months => computed = 3x rent");
  eq(snap.conservativeOwingCents, 3 * RENT, "no credits => conservative == computed");
  eq(snap.totalOwingCents, 3 * RENT, "total = computed when clean, no override");
  eq(snap.terminationDateISO, "2026-07-27", "termination = notice + 14 (monthly)");
  eq(snap.arrearsRows.length, 3, "3 periods => 3 rows");
  eq(snap.hadUnresolvedCredits, false, "no unresolved credits");
  eq(n4SnapshotBlocker(snap), null, "clean snapshot has no blocker");
  ok(n4SnapshotReady(snap), "clean snapshot is ready");
}

// (b) One period fully paid (assigned) -> arrears drop, still reconciles.
{
  const payments: PaymentRow[] = [{ amount_cents: RENT, period_month: "2026-06-01" }];
  const snap = buildN4Snapshot({ ...base, noticeDateISO: "2026-07-13", payments });
  eq(snap.totalOwingCents, 2 * RENT, "one assigned payment => 2 months owing");
  eq(n4SnapshotBlocker(snap), null, "assigned payment reconciles");
}

// (c) Unassigned payment -> blocked (operator must assign it first).
{
  const payments: PaymentRow[] = [{ amount_cents: 50000, period_month: null }];
  const snap = buildN4Snapshot({ ...base, noticeDateISO: "2026-07-13", payments });
  eq(snap.hadUnresolvedCredits, true, "unassigned payment flagged");
  eq(snap.unassignedPaidCents, 50000, "unassigned surfaced");
  eq(n4SnapshotBlocker(snap), "unresolved_credits", "unresolved credits block the fill");
  ok(!n4SnapshotReady(snap), "not ready with unresolved credits");
}

// (d) Fully paid up -> no arrears -> blocked as no_arrears.
{
  const payments: PaymentRow[] = [
    { amount_cents: RENT, period_month: "2026-05-01" },
    { amount_cents: RENT, period_month: "2026-06-01" },
    { amount_cents: RENT, period_month: "2026-07-01" },
  ];
  const snap = buildN4Snapshot({ ...base, noticeDateISO: "2026-07-13", payments });
  eq(snap.totalOwingCents, 0, "paid up => 0 owing");
  eq(n4SnapshotBlocker(snap), "no_arrears", "no arrears blocks");
}

// (e) >3 periods pack to the 2-row overflow and still reconcile.
{
  const snap = buildN4Snapshot({ ...base, startDateISO: "2026-03-01", noticeDateISO: "2026-07-13", payments: [] });
  eq(snap.arrearsRows.length, 2, "5 periods pack to 2 rows (combined + last)");
  eq(snap.totalOwingCents, 5 * RENT, "5 months owing");
  eq(n4SnapshotBlocker(snap), null, "packed overflow still reconciles");
}

// (f) snapshotToN4Fill maps the fields the official form needs.
{
  const snap = buildN4Snapshot({ ...base, noticeDateISO: "2026-07-13", payments: [] });
  const fill = snapshotToN4Fill(snap);
  eq(fill.landlordName, base.landlordName, "fill carries landlord name");
  eq(fill.tenantNames, base.tenantNames, "fill carries tenant names");
  eq(fill.totalOwingCents, 3 * RENT, "fill total owing");
  eq(fill.terminationDateISO, "2026-07-27", "fill termination date");
  eq(fill.arrearsRows.length, 3, "fill arrears rows");
  eq(fill.signer.type, "landlord", "landlord signer");
  eq(fill.signer.firstName, "Noam", "signer first name");
}

// (g) override DOWN reconciles: rows credited to sum exactly to the override.
{
  const snap = buildN4Snapshot({ ...base, noticeDateISO: "2026-07-13", payments: [], overrideOwingCents: 400000 });
  eq(snap.totalOwingCents, 400000, "down override wins the total");
  eq(snap.arrearsRows.reduce((s, r) => s + r.owingCents, 0), 400000, "rows credited to reconcile to the override");
  ok(snap.arrearsRows.every((r) => r.chargedCents - r.paidCents === r.owingCents), "credited rows keep charged-paid=owing");
  eq(n4SnapshotBlocker(snap), null, "down override reconciles -> no blocker");
  ok(n4SnapshotReady(snap), "down override is ready to fill");
}

// (h) override ABOVE the ledger is rejected as overstated (a void N4).
{
  const snap = buildN4Snapshot({ ...base, noticeDateISO: "2026-07-13", payments: [], overrideOwingCents: 900000 });
  eq(snap.totalOwingCents, 900000, "over-override sets the total");
  ok(snap.arrearsRows.reduce((s, r) => s + r.owingCents, 0) < snap.totalOwingCents, "rows sum stays below an overstated total");
  eq(n4SnapshotBlocker(snap), "overstated", "override above the ledger is blocked as overstated");
  ok(!n4SnapshotReady(snap), "overstated snapshot is not ready");
}

console.log(`test-n4-snapshot: ${pass}/${fail}`);
if (fail > 0) process.exit(1);

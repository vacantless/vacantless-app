// S746: the free Ontario rent-increase tool (lib/rent-increase-tool.ts).
// Pure checks: parsing a stranger's query, the dates and amounts, the wanted
// start day, exempt units, a missing guideline year, and the snapshot shape.
// Run: npx tsx scripts/test-rent-increase-tool.ts
import {
  centsToDollars,
  computeTool,
  dollarsToCents,
  parseToolParams,
  resultSentence,
  toolQuery,
  toolSnapshot,
} from "../lib/rent-increase-tool";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}`, extra ?? "");
  }
}
const eq = (name: string, got: unknown, want: unknown) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

const TODAY = "2026-11-04";
const G = (y: number) => ({ 2026: 2.1, 2027: 1.9 } as Record<number, number>)[y] ?? null;

// --- money parsing
eq("1,500 -> cents", dollarsToCents("1,500"), 150000);
eq("$1500.00 -> cents", dollarsToCents("$1500.00"), 150000);
eq("1500.5 -> cents", dollarsToCents("1500.5"), 150050);
eq("junk -> null", dollarsToCents("abc"), null);
eq("zero -> null", dollarsToCents("0"), null);
eq("too big -> null", dollarsToCents("1000000"), null);
eq("dollars no cents", centsToDollars(152850), "$1,528.50");
eq("dollars whole", centsToDollars(150000), "$1,500");

// --- parsing a query
const bad1 = parseToolParams(new URLSearchParams("start=2025-06-01"));
ok("missing rent refused", !bad1.ok);
const bad2 = parseToolParams(new URLSearchParams("rent=1500&start=2025-13-01"));
ok("bad date refused", !bad2.ok);
const p = parseToolParams(
  new URLSearchParams(
    "rent=1,500&start=2025-06-01&landlord=Jane%20Doe&tenants=Sam%20Lee,%20Ana%20Ruiz,,&address=12%20Main%20St%20Unit%202&phone=416-555-0100&email=jane%40example.com",
  ),
);
ok("good query parses", p.ok);
if (p.ok) {
  eq("rent cents", p.input.rentCents, 150000);
  eq("tenants split and trimmed", p.input.tenantNames, ["Sam Lee", "Ana Ruiz"]);
  eq("not exempt by default", p.input.exempt, false);
  eq("no wanted date", p.input.wantedEffectiveDate, null);
  const back = parseToolParams(new URLSearchParams(toolQuery(p.input)));
  ok("toolQuery round-trips", back.ok && JSON.stringify(back.input) === JSON.stringify(p.input));
}

// control characters and length caps never reach the form
const dirty = parseToolParams(
  new URLSearchParams({ rent: "1500", start: "2025-06-01", landlord: "A\u0000B\u0007C " + "x".repeat(500) }),
);
ok("control chars stripped", dirty.ok && !/[\u0000-\u001f]/.test(dirty.input.landlordName));
ok("landlord capped at 120", dirty.ok && dirty.input.landlordName.length <= 120);

// --- compute: overdue tenancy, no wanted date
if (p.ok) {
  const r = computeTool(p.input, TODAY, G)!;
  eq("earliest legal day = move-in + 12 months", r.earliestEffectiveDate, "2026-06-01");
  eq("status overdue", r.status, "overdue");
  eq("effective = today + 90", r.effectiveDate, "2027-02-02");
  eq("serve by = effective - 90 = today", r.serveByDate, TODAY);
  eq("guideline for 2027", r.guidelinePercent, 1.9);
  eq("new rent 1500 * 1.019", r.newRentCents, 152850);
  eq("increase", r.increaseCents, 2850);
  ok("sentence names the amount and dates", resultSentence(r).includes("$1,528.50") && resultSentence(r).includes("February 2, 2027"));
  ok("no em dash in the sentence", !resultSentence(r).includes("\u2014"));

  // wanted start day, legal: first of the month after
  const r2 = computeTool({ ...p.input, wantedEffectiveDate: "2027-03-01" }, TODAY, G)!;
  eq("wanted day honoured", r2.effectiveDate, "2027-03-01");
  eq("serve by moves with it", r2.serveByDate, "2026-12-01");
  eq("not flagged", r2.wantedTooEarly, false);

  // wanted start day too soon: legal day used, flagged
  const r3 = computeTool({ ...p.input, wantedEffectiveDate: "2026-12-01" }, TODAY, G)!;
  eq("too-early day replaced", r3.effectiveDate, "2027-02-02");
  eq("too-early flagged", r3.wantedTooEarly, true);

  // guideline year not published
  const r4 = computeTool({ ...p.input, wantedEffectiveDate: "2030-01-01" }, TODAY, G)!;
  eq("missing guideline -> null", r4.guidelinePercent, null);
  eq("missing guideline -> no amount", r4.newRentCents, null);
  ok("missing guideline flagged", r4.guidelineMissing);
  ok("sentence says not published", resultSentence(r4).includes("not published"));

  // snapshot shape
  const snap = toolSnapshot(p.input, r2, "2026-11-04T13:00:00.000Z");
  eq("snapshot new rent string", snap.newRent, "$1,528.50");
  eq("snapshot increase string", snap.increaseAmount, "$28.50");
  eq("snapshot landlord", snap.landlordName, "Jane Doe");
  eq("snapshot tenants", snap.tenantNames, ["Sam Lee", "Ana Ruiz"]);
  eq("snapshot address", snap.rentalUnitAddress, "12 Main St Unit 2");
  eq("snapshot effective", snap.effectiveDate, "2027-03-01");
  eq("snapshot exempt false", snap.exempt, false);
}

// --- scheduled tenancy: moved in 2026-09-01, nothing due yet
const sched = computeTool(
  { rentCents: 200000, baseDate: "2026-09-01", exempt: false, wantedEffectiveDate: null, chosenNewRentCents: null, landlordName: "", landlordPhone: "", landlordEmail: "", tenantNames: [], address: "" },
  TODAY,
  G,
)!;
eq("scheduled status", sched.status, "scheduled");
eq("scheduled effective = anniversary", sched.effectiveDate, "2027-09-01");
eq("scheduled serve by", sched.serveByDate, "2027-06-03");
eq("scheduled new rent", sched.newRentCents, 203800);

// --- exempt unit: landlord chooses the rent; dates still apply
const ex = parseToolParams(new URLSearchParams("rent=1500&start=2025-06-01&exempt=1&newrent=1,650&effective=2027-03-01"));
ok("exempt query parses", ex.ok);
if (ex.ok) {
  eq("exempt chosen rent read", ex.input.chosenNewRentCents, 165000);
  const r = computeTool(ex.input, TODAY, G)!;
  eq("exempt guideline null", r.guidelinePercent, null);
  eq("exempt new rent is the chosen one", r.newRentCents, 165000);
  eq("exempt increase", r.increaseCents, 15000);
  eq("exempt effective honoured", r.effectiveDate, "2027-03-01");
  ok("exempt not flagged as missing guideline", !r.guidelineMissing);
  ok("exempt sentence", resultSentence(r).startsWith("This unit is exempt"));
  const snap = toolSnapshot(ex.input, r, "2026-11-04T13:00:00.000Z");
  ok("exempt snapshot fills the amount", snap.newRentCents === 165000 && snap.exempt);
  // exempt without a chosen rent: dates, no amount
  const r0 = computeTool({ ...ex.input, chosenNewRentCents: null }, TODAY, G)!;
  eq("exempt no amount", r0.newRentCents, null);
}
// newrent is ignored unless exempt
const notEx = parseToolParams(new URLSearchParams("rent=1500&start=2025-06-01&newrent=9999"));
ok("newrent ignored when not exempt", notEx.ok && notEx.input.chosenNewRentCents === null);

console.log(`test-rent-increase-tool: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

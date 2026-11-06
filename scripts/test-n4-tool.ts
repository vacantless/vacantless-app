// S755: the free Ontario N4 tool (lib/n4-tool.ts). Pure checks: parsing, the
// months asked about, rent-due-on-the-1st, deemed service, the 7-day notice,
// row packing past three months, and every refusal that keeps a notice valid.
// Run: npx tsx scripts/test-n4-tool.ts
import {
  computeN4Tool,
  lastOwingMonth,
  moneyToCents,
  monthsBetween,
  n4FormReady,
  n4Query,
  n4ResultSentence,
  n4ToolSnapshot,
  parseN4Params,
  type N4ToolInput,
} from "../lib/n4-tool";

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

const TODAY = "2026-11-06";
const base: N4ToolInput = {
  rentCents: 150000,
  firstMonth: "2026-11",
  paidCents: [],
  serviceDate: "2026-11-06",
  method: "hand",
  landlordName: "Pat Landlord",
  signerFirstName: "Pat",
  signerLastName: "Landlord",
  phone: "519-555-0100",
  tenantNames: ["Sam Tenant"],
  address: "12 Main St, Unit 3, Windsor, ON N8Y 3B4",
};

// --- money
eq("money 1,500", moneyToCents("1,500"), 150000);
eq("money zero refused", moneyToCents("0"), null);
eq("money zero allowed", moneyToCents("0", true), 0);
eq("money blank allowed -> 0", moneyToCents("", true), 0);
eq("money junk", moneyToCents("abc", true), null);

// --- months
eq("served on the 1st excludes that month", lastOwingMonth("2026-12-01"), "2026-11");
eq("served on the 2nd includes it", lastOwingMonth("2026-12-02"), "2026-12");
eq("months Sep..Nov", monthsBetween("2026-09", "2026-11-06"), ["2026-09", "2026-10", "2026-11"]);
eq("not late yet -> empty", monthsBetween("2026-12", "2026-12-01"), []);

// --- one month, hand delivered
{
  const out = computeN4Tool(base, TODAY);
  ok("one month ok", out.ok);
  if (out.ok) {
    eq("total", out.result.totalOwingCents, 150000);
    eq("deemed same day", out.result.deemedServiceDate, "2026-11-06");
    eq("7 days", out.result.noticeDays, 7);
    eq("termination", out.result.terminationDate, "2026-11-13");
    eq("one row", out.result.formRows.length, 1);
    eq("row dates", [out.result.formRows[0].fromISO, out.result.formRows[0].toISO], ["2026-11-01", "2026-11-30"]);
    ok("sentence names amount and date", /\$1,500/.test(n4ResultSentence(out.result)) && /November 13, 2026/.test(n4ResultSentence(out.result)));
    ok("no em dash", !/—/.test(n4ResultSentence(out.result)));
    const snap = n4ToolSnapshot(base, out.result);
    eq("snap total", snap.totalOwingCents, 150000);
    eq("snap signer", snap.signer.type, "landlord");
  }
}

// --- mail adds 5, courier next business day (Fri 2026-11-06 -> Mon 11-09)
{
  const m = computeN4Tool({ ...base, method: "mail" }, TODAY);
  ok("mail ok", m.ok);
  if (m.ok) eq("mail termination", m.result.terminationDate, "2026-11-18");
  const c = computeN4Tool({ ...base, method: "courier" }, TODAY);
  ok("courier ok", c.ok);
  if (c.ok) {
    eq("courier deemed Monday", c.result.deemedServiceDate, "2026-11-09");
    eq("courier termination", c.result.terminationDate, "2026-11-16");
  }
}

// --- partial payments, three months
{
  const out = computeN4Tool({ ...base, firstMonth: "2026-09", paidCents: [50000, 0, 150000] }, TODAY);
  ok("three months ok", out.ok);
  if (out.ok) {
    eq("total owing", out.result.totalOwingCents, 100000 + 150000 + 0);
    eq("three rows, not combined", [out.result.formRows.length, out.result.combined], [3, false]);
  }
}

// --- five months combine into two rows, last month alone
{
  const out = computeN4Tool({ ...base, firstMonth: "2026-07" }, TODAY);
  ok("five months ok", out.ok);
  if (out.ok) {
    eq("combined", out.result.combined, true);
    eq("two rows", out.result.formRows.length, 2);
    eq("row 1 span", [out.result.formRows[0].fromISO, out.result.formRows[0].toISO], ["2026-07-01", "2026-10-31"]);
    eq("row 2 is November", out.result.formRows[1].fromISO, "2026-11-01");
    eq("total", out.result.totalOwingCents, 750000);
    const sum = out.result.formRows.reduce((s, r) => s + r.owingCents, 0);
    eq("rows sum to total", sum, out.result.totalOwingCents);
  }
}

// --- refusals
ok("past service date refused", !computeN4Tool({ ...base, serviceDate: "2026-11-05" }, TODAY).ok);
ok("not late yet refused", !computeN4Tool({ ...base, firstMonth: "2026-12", serviceDate: "2026-12-01" }, TODAY).ok);
ok("overpaid month refused", !computeN4Tool({ ...base, paidCents: [160000] }, TODAY).ok);
ok("first month paid in full refused", !computeN4Tool({ ...base, firstMonth: "2026-10", paidCents: [150000, 0] }, TODAY).ok);
ok("first month in the future refused", !computeN4Tool({ ...base, firstMonth: "2027-01" }, TODAY).ok);

// --- parse round trip
{
  const input = { ...base, firstMonth: "2026-09", paidCents: [50000, 0, 0], method: "mail" as const };
  const back = parseN4Params(new URLSearchParams(n4Query(input)));
  ok("round trip ok", back.ok);
  if (back.ok) eq("round trip equal", back.input, input);
  const bad = parseN4Params(new URLSearchParams("rent=abc&first=2026-09&served=2026-11-06"));
  ok("bad rent refused", !bad.ok);
  const badDate = parseN4Params(new URLSearchParams("rent=1500&first=2026-09&served=2026-02-30"));
  ok("impossible date refused", !badDate.ok);
  const weird = parseN4Params(new URLSearchParams("rent=1500&first=2026-09&served=2026-11-06&method=email"));
  ok("unknown method falls back to hand", weird.ok && weird.input.method === "hand");
}

// --- form readiness
ok("ready with names", n4FormReady(base));
ok("not ready without tenant", !n4FormReady({ ...base, tenantNames: [] }));

console.log(`test-n4-tool: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

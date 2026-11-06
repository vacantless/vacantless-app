// S757: the free Ontario N8 tool (lib/n8-tool.ts). Pure checks: the months
// asked about, more than 7 days late, only rent due on or after 2026-09-21
// counting toward the 3, the 60-day termination date, refusals and parsing.
// Run: npx tsx scripts/test-n8-tool.ts
import { computeN8Tool, n8MonthsToAsk, n8Query, n8ResultSentence, n8ToolFill, parseN8Params, type N8ToolInput } from "../lib/n8-tool";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}`, extra ?? "");
  }
}
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

const TODAY = "2026-11-06";
const base: N8ToolInput = {
  rentCents: 125000,
  serviceDate: TODAY,
  method: "hand",
  paidOn: {},
  fixedTermEnd: null,
  terminationDate: null,
  landlordName: "Sam Lee",
  signerFirstName: "Sam",
  signerLastName: "Lee",
  phone: "519-555-0100",
  tenantNames: ["Pat Doe"],
  address: "12 Main St, Unit 3, Windsor, ON N8Y 3B4",
};
function run(i: N8ToolInput) {
  const o = computeN8Tool(i, TODAY);
  if (!o.ok) throw new Error(o.error);
  return o.result;
}

eq("months asked (6, oldest first)", n8MonthsToAsk("2026-11-06"), ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
eq("months asked on the 1st", n8MonthsToAsk("2026-12-01").slice(-1), ["2026-12"]);

// Today: Sept late is history, Oct counts, Nov 4 days late does not.
let r = run({ ...base, paidOn: { "2026-09": "2026-09-15", "2026-10": "2026-10-12", "2026-11": "2026-11-05" } });
eq("late months", r.late.map((l) => l.periodISO), ["2026-09-01", "2026-10-01"]);
eq("counted", r.counted.map((l) => l.periodISO), ["2026-10-01"]);
eq("earlier", r.earlier.map((l) => l.periodISO), ["2026-09-01"]);
ok("too few", r.problems.some((p) => p.code === "too_few_late"));
ok("details list October", r.details.includes("October 2026"));
ok("details keep September as history", r.details.includes("Earlier"));
const s = n8ResultSentence({ ...base, serviceDate: TODAY }, r);
ok("sentence says 1 counts", s.startsWith("1 late payment counts"));
ok("sentence gives December 9", s.includes("December 9, 2026"));
ok("no em dash", !s.includes("—"));
ok("exactly 7 days is not late", run({ ...base, paidOn: { "2026-10": "2026-10-08" } }).late.length === 0);
ok("8 days is late", run({ ...base, paidOn: { "2026-10": "2026-10-09" } }).late.length === 1);

// January 2027: Oct, Nov, Dec late -> 3, ready.
const jan: N8ToolInput = { ...base, serviceDate: "2027-01-20", paidOn: { "2026-10": "2026-10-12", "2026-11": "2026-11-15", "2026-12": "2026-12-20" } };
r = run(jan);
eq("three counted", r.counted.length, 3);
eq("no problems", r.problems, []);
eq("termination 60 days to end of March", r.terminationDate, "2027-03-31");
ok("ready sentence", n8ResultSentence(jan, r).includes("3 times"));
ok("no December hint later on", !n8ResultSentence({ ...jan, paidOn: {} }, run({ ...jan, paidOn: {} })).includes("December 9"));
eq("fill", n8ToolFill(jan, r).terminationDateISO, "2027-03-31");
ok("too soon end", run({ ...jan, terminationDate: "2027-02-28" }).problems.some((p) => p.code === "too_soon"));
ok("mid-month end", run({ ...jan, terminationDate: "2027-04-15" }).problems.some((p) => p.code === "not_period_end"));
ok("no tenant", run({ ...jan, tenantNames: [] }).problems.some((p) => p.code === "no_tenant"));

// Refusals.
ok("past service date", !computeN8Tool({ ...base, serviceDate: "2026-11-05" }, TODAY).ok);
ok("paid before due", !computeN8Tool({ ...base, paidOn: { "2026-10": "2026-09-30" } }, TODAY).ok);
ok("paid after the notice", !computeN8Tool({ ...base, paidOn: { "2026-10": "2026-11-10" } }, TODAY).ok);

// Parse and query.
const q = n8Query(jan);
const p = parseN8Params(new URLSearchParams(q));
ok("parse ok", p.ok);
if (p.ok) {
  eq("paid dates", p.input.paidOn, jan.paidOn);
  eq("served", p.input.serviceDate, "2027-01-20");
}
const outside = parseN8Params(new URLSearchParams("rent=1250&served=2026-11-06&late=2025-01:2025-01-20|2026-10:2026-10-12"));
ok("month outside the window dropped", outside.ok && Object.keys(outside.input.paidOn).join() === "2026-10");
ok("bad date refused", !parseN8Params(new URLSearchParams("rent=1250&served=2026-11-06&late=2026-10:2026-13-40")).ok);

console.log(`test-n8-tool: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

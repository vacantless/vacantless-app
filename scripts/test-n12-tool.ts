// S757: the free Ontario N12 tool (lib/n12-tool.ts). Pure checks: parsing,
// 60 days to the end of a month, mail and courier days, the 120-day
// no-compensation rule for own use, the buyer reason always paying, fixed
// terms, and the problems that keep a notice valid.
// Run: npx tsx scripts/test-n12-tool.ts
import { computeN12Tool, n12Query, n12ResultSentence, n12ToolFill, parseN12Params, type N12ToolInput } from "../lib/n12-tool";

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
const base: N12ToolInput = {
  reason: 1,
  personName: "Sam Lee",
  relationship: "self",
  careProvider: false,
  rentCents: 150000,
  serviceDate: TODAY,
  method: "hand",
  fixedTermEnd: null,
  terminationDate: null,
  landlordName: "Sam Lee",
  landlordIsIndividual: true,
  signerFirstName: "Sam",
  signerLastName: "Lee",
  phone: "519-555-0100",
  tenantNames: ["Pat Doe"],
  address: "12 Main St, Unit 3, Windsor, ON N8Y 3B4",
};
function run(i: N12ToolInput) {
  const o = computeN12Tool(i, TODAY);
  if (!o.ok) throw new Error(o.error);
  return o.result;
}

// Earliest date: 60 days from Nov 6 is Jan 5, so the end of January.
let r = run(base);
eq("earliest end", r.earliestTermination, "2027-01-31");
eq("defaults to earliest", r.terminationDate, "2027-01-31");
eq("no-comp date (120 days, end of March)", r.noCompensationDate, "2027-03-31");
ok("own use under 120 days pays", r.compensationRequired);
eq("compensation is one month", r.compensationCents, 150000);
eq("no problems", r.problems, []);
ok("sentence names the amount", n12ResultSentence(base, r).includes("$1,500"));
ok("sentence suggests the 120-day date", n12ResultSentence(base, r).includes("March 31, 2027"));
ok("no em dash", !n12ResultSentence(base, r).includes("—"));

// Own use at 120+ days: no compensation.
r = run({ ...base, terminationDate: "2027-03-31" });
ok("own use at 120 days owes nothing", !r.compensationRequired);
eq("no amount", r.compensationCents, null);
ok("sentence says none owed", n12ResultSentence(base, r).includes("No compensation"));

// Buyer always pays.
r = run({ ...base, reason: 2, terminationDate: "2027-03-31" });
ok("buyer pays even at 120 days", r.compensationRequired);

// Mail adds 5 days: Nov 11 + 60 = Jan 10, still end of January.
eq("mail earliest", run({ ...base, method: "mail" }).earliestTermination, "2027-01-31");
eq("mail deemed", run({ ...base, method: "mail" }).deemedServiceDate, "2026-11-11");
// Served Dec 3 by mail: Dec 8 + 60 = Feb 6 -> end of February.
eq("mail pushes a month", run({ ...base, serviceDate: "2026-12-03", method: "mail" }).earliestTermination, "2027-02-28");

// Fixed term still running ends on the term.
eq("fixed term", run({ ...base, fixedTermEnd: "2027-06-30" }).earliestTermination, "2027-06-30");

// Problems.
const codes = (i: N12ToolInput) => run(i).problems.map((p) => p.code);
ok("company landlord, own use", codes({ ...base, landlordName: "ABC Holdings Inc." }).includes("company_landlord"));
ok("not an individual, own use", codes({ ...base, landlordIsIndividual: false }).includes("company_landlord"));
ok("company fine for buyer reason", !codes({ ...base, reason: 2, landlordName: "ABC Holdings Inc.", landlordIsIndividual: false }).includes("company_landlord"));
ok("mid-month end", codes({ ...base, terminationDate: "2027-02-15" }).includes("not_period_end"));
ok("too soon", codes({ ...base, terminationDate: "2026-12-31" }).includes("too_soon"));
ok("before term end", codes({ ...base, fixedTermEnd: "2027-06-30", terminationDate: "2027-03-31" }).includes("before_term_end"));
ok("no tenant", codes({ ...base, tenantNames: [] }).includes("no_tenant"));
ok("no address", codes({ ...base, address: "" }).includes("no_address"));
ok("no person", codes({ ...base, personName: "" }).includes("no_person"));
ok("tool text for tenant", run({ ...base, tenantNames: [] }).problems[0].text === "Enter the tenant names.");

// Refusals.
const past = computeN12Tool({ ...base, serviceDate: "2026-11-05" }, TODAY);
ok("past service date refused", !past.ok);
const ended = computeN12Tool({ ...base, fixedTermEnd: "2026-10-31" }, TODAY);
ok("ended term refused", !ended.ok);

// Parse and query round trip.
const q = n12Query({ ...base, reason: 2, relationship: "child", careProvider: true, terminationDate: "2027-03-31", fixedTermEnd: "2027-03-31" });
const p = parseN12Params(new URLSearchParams(q));
ok("parse ok", p.ok);
if (p.ok) {
  eq("reason", p.input.reason, 2);
  eq("rel", p.input.relationship, "child");
  eq("care", p.input.careProvider, true);
  eq("end", p.input.terminationDate, "2027-03-31");
  eq("individual", p.input.landlordIsIndividual, true);
  eq("tenants", p.input.tenantNames, ["Pat Doe"]);
  eq("rent", p.input.rentCents, 150000);
}
const bad = parseN12Params(new URLSearchParams("rent=abc&served=2026-11-06"));
ok("bad rent refused", !bad.ok);
const badRel = parseN12Params(new URLSearchParams("rent=1500&served=2026-11-06&rel=cousin"));
ok("unknown relationship falls back to self", badRel.ok && badRel.input.relationship === "self");
const junk = parseN12Params(new URLSearchParams("rent=1500&served=2026-11-06&landlord=" + encodeURIComponent("A\u0000B" + "x".repeat(500))));
ok("text cleaned and capped", junk.ok && junk.input.landlordName.length <= 120 && !junk.input.landlordName.includes("\u0000"));

// Fill snapshot.
const fill = n12ToolFill(run(base));
eq("fill date", fill.terminationDateISO, "2027-01-31");
eq("fill reason", fill.reason, 1);
eq("fill signer", fill.signer.firstName, "Sam");

console.log(`test-n12-tool: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

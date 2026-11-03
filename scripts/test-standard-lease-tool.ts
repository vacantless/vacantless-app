// S746c: the free Ontario Standard Lease tool (lib/standard-lease-tool.ts).
// Run: npx tsx scripts/test-standard-lease-tool.ts
import { readFileSync } from "node:fs";
import { leaseToolFromForm, problemsPage } from "../lib/standard-lease-tool";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}`, extra ?? "");
  }
}
const form = (o: Record<string, string>) => (n: string) => (n in o ? o[n] : null);

const full: Record<string, string> = {
  landlord_name: "Jane Doe",
  tenant1: "Sam Lee",
  tenant2: " Ana Ruiz ",
  address: "Unit 2, 12 Main St, Windsor ON N9A 1A1",
  is_condo: "no",
  notice_street_number: "506",
  notice_street_name: "Manning Avenue",
  notice_city: "Toronto",
  notice_province: "Ontario",
  notice_postal_code: "M6G 2V7",
  email_notices: "yes",
  email_addresses: "jane@example.com",
  emergency_contact: "yes",
  emergency_contact_info: "416-555-0100",
  start_date: "2026-12-01",
  term: "fixed",
  end_date: "2027-11-30",
  rent: "1,500",
  deposit: "1500",
  payment_methods: "E-transfer",
  gas: "no", air_conditioning: "no", storage: "no", laundry: "yes", laundry_charge: "no_charge", guest_parking: "no",
  electricity: "tenant", heat: "landlord", water: "landlord",
  tenant_insurance: "yes",
  additional_terms: "No smoking.\nTenant clears snow.",
};

const t = leaseToolFromForm(form(full));
ok("landlord name", t.input.landlordName === "Jane Doe");
ok("legal name falls back to landlord name", t.input.details.landlordLegalName === "Jane Doe");
ok("tenants trimmed", JSON.stringify(t.input.tenantNames) === JSON.stringify(["Sam Lee", "Ana Ruiz"]));
ok("rent cents", t.input.rentCents === 150000);
ok("deposit cents", t.input.depositCents === 150000);
ok("fixed term keeps end date", t.input.endDate === "2027-11-30");
ok("additional terms kept with newlines", t.additionalTerms === "No smoking.\nTenant clears snow." && t.input.hasAdditionalTerms);
ok("nothing missing when complete", t.missing.length === 0, t.missing);
ok("no problems when complete", t.problems.length === 0, t.problems);

// monthly term drops the end date
const m = leaseToolFromForm(form({ ...full, term: "monthly" }));
ok("monthly ignores end date", m.input.endDate === null);

// fixed term with no end date is a problem; end before start is a problem
ok("fixed needs an end", leaseToolFromForm(form({ ...full, end_date: "" })).problems.some((p) => p.includes("end date")));
ok("end after start", leaseToolFromForm(form({ ...full, end_date: "2026-01-01" })).problems.some((p) => p.includes("after the start")));

// the form's own limits still apply
ok("deposit over rent refused", leaseToolFromForm(form({ ...full, deposit: "2000" })).problems.some((p) => p.includes("one month")));
ok("NSF over $20 refused", leaseToolFromForm(form({ ...full, nsf_charge: "25" })).problems.some((p) => p.includes("$20")));

// blanks are missing, not problems
const sparse = leaseToolFromForm(form({ landlord_name: "", tenant1: "", rent: "", start_date: "" }));
ok("missing lists the landlord first", sparse.missing[0] === "the landlord's name");
ok("missing lists a tenant and the rent", sparse.missing.includes("at least one tenant") && sparse.missing.includes("the rent"));
ok("blanks are not problems", sparse.problems.length === 0);

// junk is cleaned and capped
const dirty = leaseToolFromForm(form({ ...full, landlord_name: "A\u0000B " + "x".repeat(400), additional_terms: "y".repeat(10000) }));
ok("control chars out", !/\u0000/.test(dirty.input.landlordName));
ok("landlord capped", dirty.input.landlordName.length <= 120);
ok("terms capped at 6000", (dirty.additionalTerms ?? "").length === 6000);

// the refusal page escapes
const page = problemsPage(["<b>bad</b> & worse"]);
ok("problems page escapes html", page.includes("&lt;b&gt;bad&lt;/b&gt; &amp; worse") && page.includes("noindex"));
ok("no em dash in the lib", !readFileSync("lib/standard-lease-tool.ts", "utf8").includes("—"));

// wiring
const pageSrc = readFileSync("app/tools/standard-lease/page.tsx", "utf8");
ok("page posts to the pdf route", pageSrc.includes('method="post"') && pageSrc.includes("${LEASE_TOOL_PATH}/pdf"));
for (const n of ["landlord_name", "tenant1", "address", "start_date", "term", "end_date", "rent", "deposit", "additional_terms", "electricity", "tenant_insurance", "nsf_charge"]) {
  ok(`page has field ${n}`, pageSrc.includes(`name="${n}"`) || pageSrc.includes(`name={\`${n}`));
}
const route = readFileSync("app/tools/standard-lease/pdf/route.ts", "utf8");
ok("route refuses on problems", route.includes("problemsPage(tool.problems)") && route.includes("status: 400"));
ok("route fills without signatures", route.includes("signatures: []"));

console.log(`test-standard-lease-tool: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

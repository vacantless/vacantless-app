// Unit tests for the pure lease-document renderer (lib/lease-render.ts).
// Run: npx tsx scripts/test-lease-render.ts
import {
  escapeHtml,
  renderLeaseDocumentHtml,
  type LeaseRenderModel,
} from "../lib/lease-render";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("  ✗ " + msg);
  }
}

function baseModel(over: Partial<LeaseRenderModel> = {}): LeaseRenderModel {
  return {
    title: "Residential Lease",
    status: "draft",
    generatedAtIso: "2026-06-18T13:00:00.000Z",
    landlordName: "Agile Real Estate Group",
    propertyAddress: "159 Pillette Rd, Unit 22, Windsor ON",
    tenantNames: ["Dana Tenant", "Sam Cotenant"],
    rent: "$1,250",
    deposit: "$1,250",
    startDate: "2026-07-01",
    endDate: "2027-06-30",
    termMonths: 12,
    clauseBody: "Pets: One cat permitted.\n\nParking: 1 space at $50/mo.",
    ...over,
  };
}

// --- escapeHtml --------------------------------------------------------------
assert(escapeHtml("<b>&\"'") === "&lt;b&gt;&amp;&quot;&#39;", "escapeHtml escapes all five");
assert(escapeHtml("plain") === "plain", "escapeHtml leaves plain text alone");

// --- structural --------------------------------------------------------------
const html = renderLeaseDocumentHtml(baseModel());
assert(html.startsWith("<!doctype html>"), "renders a full HTML document");
assert(html.includes("window.print()"), "includes a print button");
assert(html.includes("Residential Lease"), "includes the title");
assert(html.includes("159 Pillette Rd, Unit 22, Windsor ON"), "includes the premises");
assert(html.includes("Agile Real Estate Group"), "includes the landlord name");
assert(html.includes("Dana Tenant, Sam Cotenant"), "lists both tenants in the parties table");
assert(html.includes("$1,250"), "includes formatted rent/deposit");
assert(html.includes("12 months"), "term label for 12 months");
assert(html.includes("Pets: One cat permitted."), "includes the clause body text");
assert(html.includes("Electronic Commerce Act, 2000"), "includes the ECA-2000 attestation footer");
assert(html.includes("2026-06-18"), "footer shows the generated date (YYYY-MM-DD)");

// --- signature blocks --------------------------------------------------------
// One landlord block + one per tenant = 3 "signature" lines here.
const sigCount = (html.match(/signature<\/span>/g) ?? []).length;
assert(sigCount === 3, `one signature block per party (landlord + 2 tenants), got ${sigCount}`);

// --- draft banner ------------------------------------------------------------
assert(html.includes("DRAFT"), "draft status shows the DRAFT banner");
const executed = renderLeaseDocumentHtml(baseModel({ status: "executed" }));
assert(!executed.includes("not for signature"), "executed status hides the DRAFT banner");

// --- unresolved-token warning ------------------------------------------------
const owed = renderLeaseDocumentHtml(
  baseModel({ clauseBody: "Storage: {{storage_description}} included." }),
);
assert(owed.includes("Unfilled values remain"), "flags unresolved {{tokens}} in the body");
assert(owed.includes("{{storage_description}}"), "names the specific unresolved token");
const clean = renderLeaseDocumentHtml(baseModel({ clauseBody: "All terms filled." }));
assert(!clean.includes("Unfilled values remain"), "no token warning when none are owed");

// --- term variants -----------------------------------------------------------
assert(renderLeaseDocumentHtml(baseModel({ termMonths: 1 })).includes("1 month<"), "singular month");
assert(
  renderLeaseDocumentHtml(baseModel({ termMonths: null })).includes("Month-to-month"),
  "null term => month-to-month",
);

// --- missing / empty fields --------------------------------------------------
const sparse = renderLeaseDocumentHtml(
  baseModel({ propertyAddress: null, tenantNames: [], rent: null, deposit: null, endDate: null }),
);
assert(sparse.includes("Premises not set"), "null premises shows a placeholder subtitle");
assert(sparse.includes("&mdash;"), "missing term values render an em-dash");
// Still renders a tenant signature block even with no named tenants.
const sparseSig = (sparse.match(/signature<\/span>/g) ?? []).length;
assert(sparseSig === 2, `landlord + a blank tenant block when no tenants named, got ${sparseSig}`);

// --- XSS / HTML-injection safety --------------------------------------------
const evil = renderLeaseDocumentHtml(
  baseModel({
    tenantNames: ['<script>alert(1)</script>'],
    clauseBody: "Body <img src=x onerror=alert(1)>",
    landlordName: "<b>Land</b>",
  }),
);
assert(!evil.includes("<script>alert(1)</script>"), "tenant name is HTML-escaped (no raw script tag)");
assert(evil.includes("&lt;script&gt;"), "tenant name escaped to entities");
assert(!evil.includes("<img src=x onerror"), "clause body is HTML-escaped (no raw img tag)");
assert(!evil.includes("<b>Land</b>"), "landlord name is HTML-escaped");

// --- generatedAt fallback ----------------------------------------------------
const badDate = renderLeaseDocumentHtml(baseModel({ generatedAtIso: "not-a-date" }));
assert(badDate.includes("not-a-date"), "invalid generatedAt falls back to the raw string");

if (failed > 0) {
  console.error(`\nlease-render: ${failed} FAILED, ${passed} passed`);
  process.exit(1);
}
console.log(`lease-render: ${passed} assertions passed`);

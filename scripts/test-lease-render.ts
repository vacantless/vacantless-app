// Unit tests for the pure lease-document renderer (lib/lease-render.ts).
// Run: npx tsx scripts/test-lease-render.ts
import {
  escapeHtml,
  isSafePngDataUrl,
  renderLeaseDocumentHtml,
  type LeaseRenderModel,
  type CapturedSignature,
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

// --- isSafePngDataUrl guard --------------------------------------------------
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
assert(isSafePngDataUrl(PNG), "a real base64 PNG data URL passes the guard");
assert(isSafePngDataUrl("  " + PNG + "  "), "guard trims surrounding whitespace");
assert(!isSafePngDataUrl("data:text/html;base64,PHNjcmlwdD4="), "non-image data URL rejected");
assert(!isSafePngDataUrl("data:image/svg+xml;base64,abc"), "SVG data URL rejected");
assert(!isSafePngDataUrl("javascript:alert(1)"), "javascript: URL rejected");
assert(!isSafePngDataUrl("data:image/png;base64,<img onerror=alert(1)>"), "non-base64 chars rejected");

// --- signature stamping: helpers --------------------------------------------
function cap(over: Partial<CapturedSignature> = {}): CapturedSignature {
  return {
    signatureKind: "typed",
    signatureData: "Dana Tenant",
    signedName: "Dana Tenant",
    signedAtIso: "2026-06-18T15:30:00.000Z",
    ...over,
  };
}

// Unsigned executed/sent doc: lines stay blank, no stamp, no "Signed electronically".
const unsignedExec = renderLeaseDocumentHtml(baseModel({ status: "sent" }));
assert(!unsignedExec.includes("Signed electronically"), "no captured sig => no signed note");
assert(!unsignedExec.includes('class="sig-typed"'), "no captured sig => no typed stamp");
assert(!unsignedExec.includes("DRAFT &mdash;"), "a sent lease shows no DRAFT banner");

// Typed signature stamped for landlord + one tenant.
const typedDoc = renderLeaseDocumentHtml(
  baseModel({
    status: "executed",
    tenantNames: ["Dana Tenant", "Sam Cotenant"],
    landlordSignature: cap({ signatureData: "Agile Owner", signedName: "Agile Owner" }),
    tenantSignatures: [cap(), null],
  }),
);
assert(typedDoc.includes('class="sig-typed">Agile Owner<'), "landlord typed signature stamped");
assert(typedDoc.includes('class="sig-typed">Dana Tenant<'), "tenant 1 typed signature stamped");
assert(
  (typedDoc.match(/Signed electronically on 2026-06-18/g) ?? []).length === 2,
  "signed date shown once per signed party (landlord + tenant 1)",
);
// Tenant 2 has a null signature => still a blank line, not a stamp.
assert(typedDoc.includes('class="sig-line">&nbsp;'), "unsigned co-tenant keeps a blank line");

// Executed banner.
assert(typedDoc.includes("banner executed"), "executed status renders the executed banner");
assert(
  !renderLeaseDocumentHtml(baseModel({ status: "sent" })).includes("banner executed"),
  "a merely-sent lease shows no executed banner",
);

// Drawn signature with a SAFE PNG => <img>, not text.
const drawnDoc = renderLeaseDocumentHtml(
  baseModel({
    status: "executed",
    tenantNames: ["Dana Tenant"],
    landlordSignature: null,
    tenantSignatures: [cap({ signatureKind: "drawn", signatureData: PNG })],
  }),
);
assert(drawnDoc.includes(`<img class="sig-img" src="${PNG}"`), "safe PNG drawn sig renders as <img>");

// Drawn signature with an UNSAFE payload => never reaches src; falls back to name text.
const evilDrawn = renderLeaseDocumentHtml(
  baseModel({
    status: "executed",
    tenantNames: ["Dana Tenant"],
    landlordSignature: null,
    tenantSignatures: [
      cap({
        signatureKind: "drawn",
        signatureData: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
        signedName: "Dana Tenant",
      }),
    ],
  }),
);
assert(!evilDrawn.includes("data:text/html"), "unsafe drawn payload never reaches the document");
assert(!evilDrawn.includes("<img"), "unsafe drawn payload does not render an <img>");
assert(evilDrawn.includes('class="sig-typed">Dana Tenant<'), "unsafe drawn falls back to attested name");

// XSS in a typed signature is escaped.
const xssSig = renderLeaseDocumentHtml(
  baseModel({
    status: "executed",
    tenantNames: ["Dana Tenant"],
    landlordSignature: null,
    tenantSignatures: [cap({ signatureData: "<script>alert(1)</script>", signedName: "<b>x</b>" })],
  }),
);
assert(!xssSig.includes("<script>alert(1)</script>"), "typed signature data is HTML-escaped");
assert(!xssSig.includes("<b>x</b>"), "signed name is HTML-escaped in the name line");

// Invalid signedAt falls back gracefully (raw string, no crash).
const badSigDate = renderLeaseDocumentHtml(
  baseModel({
    status: "executed",
    tenantNames: ["Dana Tenant"],
    landlordSignature: null,
    tenantSignatures: [cap({ signedAtIso: "nope" })],
  }),
);
assert(badSigDate.includes("Signed electronically on nope"), "invalid signedAt falls back to raw string");

// A pre-slice-5 snapshot (no signature fields) still renders without throwing.
const legacy = renderLeaseDocumentHtml(baseModel({ status: "executed" }));
assert(legacy.includes("Signatures"), "executed lease without signature fields still renders");

if (failed > 0) {
  console.error(`\nlease-render: ${failed} FAILED, ${passed} passed`);
  process.exit(1);
}
console.log(`lease-render: ${passed} assertions passed`);

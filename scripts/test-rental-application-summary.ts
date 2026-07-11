// Unit tests for the rental-application SUMMARY builder + renderer (Slice 1b, S456).
// Run: npx tsx scripts/test-rental-application-summary.ts
import {
  buildApplicationSummaryModel,
  buildSummarySections,
  renderApplicationSummaryHtml,
  applicationSummaryTitle,
  stringifyFormValue,
  fieldLabel,
} from "../lib/rental-application-summary";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("rental-application-summary: builder + renderer");

// --- stringifyFormValue -----------------------------------------------------
ok("scalar trims", stringifyFormValue("  hi ") === "hi");
ok("null -> empty", stringifyFormValue(null) === "");
ok("array joins with ; ", stringifyFormValue(["a", "", "b"]) === "a; b");
ok(
  "array of objects -> k: v",
  stringifyFormValue([{ name: "Sam", age: 9 }]) === "name: Sam, age: 9",
);
ok("number stringifies", stringifyFormValue(3000) === "3000");

// --- fieldLabel -------------------------------------------------------------
ok("known label", fieldLabel("gross_income") === "Gross monthly income");
ok("unknown label falls back de-underscored", fieldLabel("foo_bar") === "foo bar");

// --- buildSummarySections ---------------------------------------------------
const sections = buildSummarySections({
  current_address: "12 Main St",
  gross_income: "3200",
  reference_1_name: "Pat",
  smoking: "No",
  // empty values are skipped
  employer: "  ",
  // unknown-but-non-sensitive key still surfaces under Other details
  favourite_colour: "blue",
});
const secTitles = sections.map((s) => s.title);
ok("residence section present", secTitles.includes("Residence history"));
ok("employment section present (gross_income)", secTitles.includes("Employment & income"));
ok("empty employer dropped", !JSON.stringify(sections).includes("Employer"));
ok("references section present", secTitles.includes("References"));
ok("household section present", secTitles.includes("Household"));
ok("unknown key surfaces under Other details", secTitles.includes("Other details"));

// --- Model B: sensitive keys never survive ----------------------------------
const withPii = buildSummarySections({
  current_address: "9 Oak Ave",
  sin: "123-456-789",
  date_of_birth: "1990-01-01",
  driver_license: "D1234",
  income_documents: "paystub.pdf",
  DOB: "1990-01-01",
});
const piiJson = JSON.stringify(withPii);
ok("no SIN in sections", !piiJson.includes("123-456-789"));
ok("no DOB value in sections", !piiJson.includes("1990-01-01"));
ok("no driver licence in sections", !piiJson.includes("D1234"));
ok("no income doc in sections", !piiJson.toLowerCase().includes("paystub"));
ok("non-sensitive kept alongside PII strip", piiJson.includes("9 Oak Ave"));

// --- Model + render ---------------------------------------------------------
const model = buildApplicationSummaryModel({
  orgName: "Agile Real Estate Group",
  brandColor: "#0b5",
  logoUrl: "https://example.com/logo.png",
  orgContact: "rentals@agileonline.ca",
  applicantName: "Jane Doe",
  applicantEmail: "jane@example.com",
  applicantPhone: "519-555-1212",
  propertyAddress: "833 Pillette Rd — Unit 20",
  payMode: "landlord",
  submittedAtIso: "2026-07-11T15:00:00.000Z",
  formData: { current_address: "12 Main St", sin: "999", gross_income: "3200" },
  generatedAtIso: "2026-07-11T16:00:00.000Z",
});
ok("payMode normalized (landlord)", model.payMode === "landlord");
ok("applicant name kept", model.applicantName === "Jane Doe");
ok("blank name -> null", buildApplicationSummaryModel({ orgName: "X", generatedAtIso: "2026-07-11T00:00:00Z", applicantName: "  " }).applicantName === null);

const html = renderApplicationSummaryHtml(model);
ok("html is a full document", html.startsWith("<!doctype html>"));
ok("html shows org name", html.includes("Agile Real Estate Group"));
ok("html shows unit", html.includes("833 Pillette Rd"));
ok("html renders a section value", html.includes("12 Main St"));
ok("html NEVER leaks the sin value", !html.includes(">999<") && !html.includes("999-"));
ok("html footer states no-PII", html.includes("no Social Insurance Number"));
ok("html escapes (no raw unescaped script inject via name)", (() => {
  const m2 = buildApplicationSummaryModel({ orgName: "<script>x</script>", generatedAtIso: "2026-07-11T00:00:00Z" });
  return !renderApplicationSummaryHtml(m2).includes("<script>x</script>");
})());
ok("bad logo url dropped (no javascript:)", (() => {
  const m3 = buildApplicationSummaryModel({ orgName: "X", logoUrl: "javascript:alert(1)", generatedAtIso: "2026-07-11T00:00:00Z" });
  return !renderApplicationSummaryHtml(m3).includes("javascript:alert");
})());

// --- title ------------------------------------------------------------------
ok("title with name", applicationSummaryTitle("Jane Doe") === "Rental application — Jane Doe");
ok("title without name", applicationSummaryTitle("  ") === "Rental application");

console.log(`\nrental-application-summary: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);

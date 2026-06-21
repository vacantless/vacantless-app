// Unit tests for the Ontario N1 pre-fill renderer (N1 PDF pre-fill, S284).
// Run: npx tsx scripts/test-n1-render.ts
import { renderN1Html, formatLongDate, type N1RenderModel } from "../lib/n1-render";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

function model(over: Partial<N1RenderModel> = {}): N1RenderModel {
  return {
    landlordName: "Agile Real Estate Group",
    landlordPhone: "226-773-7555",
    landlordEmail: "rentals@agileonline.ca",
    tenantNames: ["Jordan Tenant", "Sam Cotenant"],
    rentalUnitAddress: "833 Pillette Rd, Unit 22, Windsor, ON",
    currentRent: "$2,000",
    newRent: "$2,042",
    increaseAmount: "$42",
    guidelinePercent: 2.1,
    effectiveDate: "2027-03-01",
    serveByDate: "2026-12-01",
    exempt: false,
    generatedAtIso: "2026-06-21T15:48:00.000Z",
    ...over,
  };
}

// --- date formatting --------------------------------------------------------
ok("formatLongDate ISO -> long", formatLongDate("2027-03-01") === "March 1, 2027");
ok("formatLongDate null -> null", formatLongDate(null) === null);
ok("formatLongDate bad month passthrough", formatLongDate("2027-13-01") === "2027-13-01");
ok("formatLongDate non-iso passthrough", formatLongDate("soon") === "soon");

// --- a complete, eligible guideline N1 --------------------------------------
{
  const html = renderN1Html(model());
  ok("is a full HTML doc", html.startsWith("<!doctype html>"));
  ok("declares Form N1", html.includes("Form N1") && html.includes("Notice of Rent Increase"));
  ok("has a print button", html.includes('onclick="window.print()"'));
  ok("fills landlord name", html.includes("Agile Real Estate Group"));
  ok("fills landlord phone", html.includes("226-773-7555"));
  ok("fills landlord email", html.includes("rentals@agileonline.ca"));
  ok("fills both tenant names", html.includes("Jordan Tenant, Sam Cotenant"));
  ok("fills rental unit address", html.includes("833 Pillette Rd, Unit 22, Windsor, ON"));
  ok("fills current rent", html.includes("$2,000"));
  ok("fills new rent", html.includes("$2,042"));
  ok("fills increase amount", html.includes("$42"));
  ok("shows the guideline percent", html.includes("2.1%"));
  ok("fills the effective date (long form)", html.includes("March 1, 2027"));
  ok("states the serve-by date (long form)", html.includes("December 1, 2026"));
  ok("checks the guideline basis box", html.includes("&#10003;"));
  ok("carries the review banner", html.includes("WORKING COPY"));
  ok("has a landlord mailing-address blank line", html.includes("Landlord mailing address"));
  ok("notes the 90-day rule", html.includes("90 days"));
  ok("notes once every 12 months", html.includes("once every 12 months"));
  ok("not flagged exempt", !html.includes("appears exempt"));
}

// --- HTML escaping (injection safety) ---------------------------------------
{
  const html = renderN1Html(
    model({
      landlordName: '<script>alert(1)</script>',
      tenantNames: ['Bobby <b>Tables</b>'],
      rentalUnitAddress: '"Quote" & <Angle>',
    }),
  );
  ok("escapes a script tag", !html.includes("<script>alert(1)</script>"));
  ok("escapes landlord angle brackets", html.includes("&lt;script&gt;"));
  ok("escapes tenant markup", html.includes("Bobby &lt;b&gt;Tables&lt;/b&gt;"));
  ok("escapes address quotes + ampersand", html.includes("&quot;Quote&quot; &amp; &lt;Angle&gt;"));
}

// --- exempt unit: no computed amounts, exempt note shown --------------------
{
  const html = renderN1Html(
    model({
      exempt: true,
      newRent: null,
      increaseAmount: null,
      guidelinePercent: null,
    }),
  );
  ok("exempt note rendered", html.includes("appears exempt"));
  ok("guideline box left unchecked when exempt", !html.includes("&#10003;"));
  ok("blank line stands in for the new rent", html.includes('class="blank"'));
}

// --- missing optional fields fall back to blank fill lines ------------------
{
  const html = renderN1Html(
    model({ landlordPhone: null, landlordEmail: null, rentalUnitAddress: null }),
  );
  ok("renders blank lines for missing fields", html.includes('class="blank"'));
  ok("still a valid full doc with gaps", html.startsWith("<!doctype html>") && html.includes("Form N1"));
}

console.log(
  `\ntest-n1-render: ${passed} passed, ${failed} failed (${passed + failed} total)`,
);
if (failed > 0) process.exit(1);

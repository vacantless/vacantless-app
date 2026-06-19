// Unit tests for the pure MLS-paste parser (lib/mls-import.ts).
// Run: npx tsx scripts/test-mls-import.ts
import {
  parseMlsListing,
  parseAvailableDate,
  emptyParsedListing,
} from "../lib/mls-import";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

// --- empty / garbage --------------------------------------------------------
{
  const r = parseMlsListing("");
  ok(
    "empty string -> all unset",
    r.address === null && r.rentCents === null && r.beds === null && r.foundFields.length === 0,
  );
}
ok("whitespace -> all unset", parseMlsListing("   \n  \n").foundFields.length === 0);
{
  const r = parseMlsListing("hello there, this is not a listing at all");
  ok("garbage prose -> nothing forced", r.address === null && r.rentCents === null && r.beds === null);
}
{
  const e = emptyParsedListing();
  ok("emptyParsedListing is all-empty", e.address === null && e.foundFields.length === 0 && e.furnished === false);
}

// --- a realistic TRREB-style agent printout ---------------------------------
const TRREB = `
MLS#: W1234567
Address: 833 Pillette Rd, Unit 20, Windsor, ON
List Price: $1,950 / Monthly
Type: Apartment
Bedrooms: 2 + 1
Bathrooms: 1
Approximate Square Footage: 950
Parking: 1 surface spot
Air Conditioning: Central Air
Possession: July 1, 2026
Lease Includes: Heat, Water
Public Remarks: Bright and spacious two bedroom plus den in a quiet east-end building. Freshly painted with in-suite laundry and a private balcony overlooking the courtyard. Steps to transit and shopping.
`;
const t = parseMlsListing(TRREB);
ok("TRREB address", t.address === "833 Pillette Rd, Unit 20, Windsor, ON");
ok("TRREB rent = $1,950 -> 195000 cents", t.rentCents === 195000);
ok("TRREB beds 2+1 -> 3", t.beds === 3);
ok("TRREB baths -> 1", t.baths === 1);
ok("TRREB sqft -> 950", t.sqft === 950);
ok("TRREB parking text", t.parking === "1 surface spot");
ok("TRREB available date -> 2026-07-01", t.availableDate === "2026-07-01");
ok("TRREB A/C true", t.airConditioning === true);
ok("TRREB balcony from remarks", t.balcony === true);
ok("TRREB in-suite laundry", t.laundry === "in_suite");
ok("TRREB heat included", t.heatIncluded === true);
ok("TRREB water included", t.waterIncluded === true);
ok("TRREB hydro NOT included (not listed)", t.hydroIncluded === false);
ok(
  "TRREB description captured",
  (t.description ?? "").startsWith("Bright and spacious") &&
    (t.description ?? "").includes("balcony overlooking"),
);
ok(
  "TRREB foundFields includes the core set",
  ["Address", "Rent", "Beds", "Baths", "Square footage", "Parking", "Description", "Available date", "Air conditioning", "Balcony", "Laundry", "Heat included", "Water included"].every((x) => t.foundFields.includes(x)),
);

// --- a realtor.ca-style public paste (less labeled) -------------------------
const REALTOR_CA = `
$2,400/Monthly
12 Oakwood Avenue, Toronto, ON M6E 2V3
3 Beds
2 Baths
House for Rent
Welcome to this beautifully renovated 3 bedroom home in the heart of Oakwood Village. Featuring a finished basement, large fenced backyard, and parking for two cars. Available immediately for qualified tenants.
Square Footage: 1,500 - 2,000
`;
const rc = parseMlsListing(REALTOR_CA);
ok("realtor.ca rent $2,400", rc.rentCents === 240000);
ok("realtor.ca address (street-suffix heuristic)", rc.address === "12 Oakwood Avenue, Toronto, ON M6E 2V3");
ok("realtor.ca beds 3", rc.beds === 3);
ok("realtor.ca baths 2", rc.baths === 2);
ok("realtor.ca sqft range -> lower bound 1500", rc.sqft === 1500);
ok("realtor.ca description fallback (no label)", (rc.description ?? "").startsWith("Welcome to this beautifully"));
ok("realtor.ca 'Available immediately' -> no concrete date", rc.availableDate === null);

// --- a realtor.ca FULL-PAGE copy (stacked: label on its own line) -----------
// Copying the whole realtor.ca property page yields label/value on SEPARATE
// lines, not "Label: value". The parser must read the value from the next line.
const REALTOR_CA_STACKED = `
$2,650 / Monthly
For Rent
55 Mercer Street, Unit 1204
Toronto, ON M5V 0W4
Bedrooms
2 + 1
Bathrooms
2
Square Footage
1,100
Parking Type
Underground
Available
August 1, 2026
Property Type
Single Family
Inclusions
Heat, Water
`;
const st = parseMlsListing(REALTOR_CA_STACKED);
ok("stacked rent $2,650 -> 265000", st.rentCents === 265000);
ok("stacked address (street-suffix heuristic)", st.address === "55 Mercer Street, Unit 1204");
ok("stacked beds 'Bedrooms / 2 + 1' -> 3", st.beds === 3);
ok("stacked baths 'Bathrooms / 2' -> 2", st.baths === 2);
ok("stacked sqft 'Square Footage / 1,100' -> 1100", st.sqft === 1100);
ok("stacked parking 'Parking Type / Underground'", st.parking === "Underground");
ok("stacked available 'Available / August 1, 2026' -> 2026-08-01", st.availableDate === "2026-08-01");
ok("stacked inclusions 'Inclusions / Heat, Water'", st.heatIncluded === true && st.waterIncluded === true);
ok("stacked hydro NOT included", st.hydroIncluded === false);

// stacked lookahead must NOT swallow a following label when a value is blank.
{
  const r = parseMlsListing("Bedrooms\nBathrooms\n2\nSquare Footage\n900");
  ok("stacked: blank Bedrooms doesn't grab 'Bathrooms' as a value", r.beds === null);
  ok("stacked: 'Bathrooms / 2' still reads baths=2", r.baths === 2);
  ok("stacked: 'Square Footage / 900' still reads sqft=900", r.sqft === 900);
}
// a stacked label whose next line is itself a known label yields nothing for it.
ok(
  "stacked: 'Parking Type / Property Type' -> parking null (next line is a label)",
  parseMlsListing("Parking Type\nProperty Type\nSingle Family").parking === null,
);
// inline form still works after enabling the lookahead (no regression).
ok("inline 'Bedrooms: 2' still works", parseMlsListing("Bedrooms: 2").beds === 2);
ok("inline 'Square Footage: 1200' still works", parseMlsListing("Square Footage: 1200").sqft === 1200);

// --- negation / false-positive guards ---------------------------------------
ok("'A/C: None' -> AC false", parseMlsListing("Air Conditioning: None").airConditioning === false);
ok("'No balcony' -> balcony false", parseMlsListing("No balcony in this unit.").balcony === false);
ok("'unfurnished' -> furnished false", parseMlsListing("This unit is unfurnished.").furnished === false);
ok("'fully furnished' -> furnished true", parseMlsListing("The suite is fully furnished.").furnished === true);
ok("'Parking: None' -> parking null", parseMlsListing("Parking: None").parking === null);
{
  const r = parseMlsListing("Tenant pays hydro. Heat included.");
  ok("'Tenant pays hydro' does NOT mark hydro included", r.hydroIncluded === false && r.heatIncluded === true);
}
ok("bare sale price w/o monthly marker ignored", parseMlsListing("Asking $450,000 for this property.").rentCents === null);
ok("implausibly high 'rent' rejected", parseMlsListing("Rent: $90,000").rentCents === null);

// --- bed/bath inline forms --------------------------------------------------
ok("'2 bd' inline", parseMlsListing("Cozy 2 bd 1 ba apartment").beds === 2);
ok("'1.5 baths' inline", parseMlsListing("3 bedroom, 1.5 baths").baths === 1.5);
ok("studio: 0 beds when stated", parseMlsListing("Bedrooms: 0").beds === 0);

// --- date parsing variants --------------------------------------------------
ok("parseAvailableDate ISO", parseAvailableDate("2026-07-01") === "2026-07-01");
ok("parseAvailableDate MM/DD/YYYY", parseAvailableDate("07/01/2026") === "2026-07-01");
ok("parseAvailableDate M/D/YY", parseAvailableDate("7/1/26") === "2026-07-01");
ok("parseAvailableDate 'July 1, 2026'", parseAvailableDate("July 1, 2026") === "2026-07-01");
ok("parseAvailableDate '1 July 2026'", parseAvailableDate("1 July 2026") === "2026-07-01");
ok("parseAvailableDate 'Aug 15 2026'", parseAvailableDate("Aug 15 2026") === "2026-08-15");
ok("parseAvailableDate 'Immediate' -> null", parseAvailableDate("Immediate") === null);
ok("parseAvailableDate 'TBA' -> null", parseAvailableDate("TBA") === null);
ok("parseAvailableDate '30/60 days' -> null", parseAvailableDate("30/60 days") === null);
ok("parseAvailableDate null -> null", parseAvailableDate(null) === null);

// --- pets are NEVER inferred (RTA s.14 boundary) ----------------------------
{
  const r = parseMlsListing("Pet friendly building, cats and dogs welcome!");
  ok(
    "pet-friendly prose does NOT leak a pet field",
    !r.foundFields.some((f) => /pet/i.test(f)) && r.furnished === false,
  );
}

// --- address conservatism ---------------------------------------------------
ok("no street-suffix line -> address null", parseMlsListing("Bedrooms: 2\nBathrooms: 1").address === null);
{
  const r = parseMlsListing("Some heading\nAddress: 5 King St W, Toronto\n99 Random text");
  ok("explicit Address label wins over heuristic", r.address === "5 King St W, Toronto");
}

console.log(`\nmls-import: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

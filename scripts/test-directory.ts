// Unit tests for the pure trades-directory domain model. Run: npx tsx scripts/test-directory.ts
import {
  DIRECTORY_SOURCES,
  isDirectorySource,
  directorySourceLabel,
  provenanceLabel,
  validateDirectoryListingInput,
  directoryErrorMessage,
  minimizeForDirectory,
  canRevealContact,
  publicListingView,
  serviceAreaMatches,
  rankListings,
  type DirectoryListing,
} from "../lib/directory";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- Value sets -------------------------------------------------------------
ok("DIRECTORY_SOURCES has the three sources", DIRECTORY_SOURCES.length === 3);
ok("isDirectorySource accepts landlord", isDirectorySource("landlord"));
ok("isDirectorySource accepts self", isDirectorySource("self"));
ok("isDirectorySource accepts curated", isDirectorySource("curated"));
ok("isDirectorySource rejects junk", !isDirectorySource("vendor"));
ok("sourceLabel known", directorySourceLabel("self") === "Self-listed");
ok("sourceLabel falls back to raw", directorySourceLabel("mystery") === "mystery");

// --- provenanceLabel (the factual-framing rule) -----------------------------
ok(
  "verified -> Vacantless-verified (regardless of source)",
  provenanceLabel("self", 99, true) === "Vacantless-verified",
);
ok(
  "landlord with 3 uses -> plural social proof",
  provenanceLabel("landlord", 3) === "Used by 3 landlords near you",
);
ok(
  "landlord with 1 use -> singular",
  provenanceLabel("landlord", 1) === "Used by 1 landlord near you",
);
ok(
  "landlord with 0 uses -> non-vouching listed label",
  provenanceLabel("landlord", 0) === "Listed by a landlord near you",
);
ok(
  "landlord with negative count treated as 0",
  provenanceLabel("landlord", -5) === "Listed by a landlord near you",
);
ok(
  "self (unverified) -> self-listed, not verified",
  provenanceLabel("self", 0) === "Self-listed - not yet verified by Vacantless",
);
ok(
  "self label uses a hyphen, never an em dash",
  !provenanceLabel("self", 0).includes("—"),
);
ok(
  "curated but NOT verified -> not a verified claim",
  provenanceLabel("curated", 0, false) === "Added by Vacantless",
);
ok(
  "unknown source -> neutral non-vouching label",
  provenanceLabel("bogus", 2) === "Listed on Vacantless",
);
ok(
  "fractional usedCount floored",
  provenanceLabel("landlord", 2.9) === "Used by 2 landlords near you",
);

// --- validateDirectoryListingInput ------------------------------------------
{
  const r = validateDirectoryListingInput({ businessName: "  " });
  ok("blank business name rejected", !r.ok && r.code === "business_name");
}
{
  const r = validateDirectoryListingInput({ businessName: "Ace Plumbing", email: "nope" });
  ok("bad email rejected", !r.ok && r.code === "email");
}
{
  const r = validateDirectoryListingInput({
    businessName: "  Ace Plumbing  ",
    tradeType: "  Plumber ",
    serviceArea: " Windsor, ON ",
    blurb: "",
    phone: " 226-555-0100 ",
    email: " ace@plumb.co ",
  });
  ok("valid input ok", r.ok);
  if (r.ok) {
    ok("business name trimmed", r.value.businessName === "Ace Plumbing");
    ok("trade type trimmed", r.value.tradeType === "Plumber");
    ok("service area trimmed", r.value.serviceArea === "Windsor, ON");
    ok("blank blurb -> null", r.value.blurb === null);
    ok("phone trimmed", r.value.phone === "226-555-0100");
    ok("email kept", r.value.email === "ace@plumb.co");
  }
}
{
  const r = validateDirectoryListingInput({ businessName: "Solo Co" });
  ok("missing optionals -> nulls", r.ok && r.value.email === null && r.value.tradeType === null);
}

// --- error messages ---------------------------------------------------------
ok("error msg for known code", directoryErrorMessage("business_name") === "Enter the trade's business name.");
ok("error msg for undefined -> null", directoryErrorMessage(undefined) === null);
ok("error msg for unknown code -> generic", typeof directoryErrorMessage("weird") === "string");

// --- minimizeForDirectory (drops note, keeps minimized set) -----------------
{
  const m = minimizeForDirectory({
    name: "  Ace Plumbing ",
    trade_type: " Plumber ",
    phone: " 226-555-0100 ",
    email: " ace@plumb.co ",
    note: "Gave us a deal last winter; cell is his personal line",
    service_area: " Windsor, ON ",
  });
  ok("minimize trims business name", m.businessName === "Ace Plumbing");
  ok("minimize keeps trade type", m.tradeType === "Plumber");
  ok("minimize keeps service area", m.serviceArea === "Windsor, ON");
  ok("minimize starts with no blurb", m.blurb === null);
  ok("minimize carries phone (for reveal-on-add)", m.phone === "226-555-0100");
  ok("minimize carries email", m.email === "ace@plumb.co");
  ok("minimize NEVER exposes a note field", !("note" in (m as Record<string, unknown>)));
  ok(
    "minimize output has no private note value anywhere",
    !JSON.stringify(m).includes("personal line"),
  );
}
{
  const m = minimizeForDirectory({ name: "Bare Co" });
  ok("minimize blank optionals -> null", m.tradeType === null && m.phone === null && m.email === null);
}

// --- canRevealContact -------------------------------------------------------
ok("contact hidden by default", canRevealContact({ contact_public: false }, false) === false);
ok("contact revealed when added", canRevealContact({ contact_public: false }, true) === true);
ok("contact revealed when public", canRevealContact({ contact_public: true }, false) === true);

// --- publicListingView (the cross-org-safe projection) ----------------------
const sampleRow: DirectoryListing = {
  id: "d1",
  source: "landlord",
  business_name: "Ace Plumbing",
  trade_type: "Plumber",
  service_area: "Windsor, ON",
  blurb: null,
  phone: "226-555-0100",
  email: "ace@plumb.co",
  contact_public: false,
  verified: false,
  used_count: 2,
};
{
  const v = publicListingView(sampleRow, false);
  ok("default cross-org read strips phone", v.phone === null);
  ok("default cross-org read strips email", v.email === null);
  ok("default read keeps business name", v.business_name === "Ace Plumbing");
  ok("default read keeps area", v.service_area === "Windsor, ON");
  ok("default read attaches provenance", v.provenance === "Used by 2 landlords near you");
  ok(
    "default read leaks no contact anywhere in payload",
    !JSON.stringify(v).includes("226-555-0100") && !JSON.stringify(v).includes("ace@plumb.co"),
  );
}
{
  const v = publicListingView(sampleRow, true);
  ok("added viewer sees phone", v.phone === "226-555-0100");
  ok("added viewer sees email", v.email === "ace@plumb.co");
}
{
  const v = publicListingView({ ...sampleRow, contact_public: true }, false);
  ok("public-contact listing reveals phone without add", v.phone === "226-555-0100");
}
{
  const v = publicListingView({ ...sampleRow, verified: true }, false);
  ok("verified listing shows verified provenance", v.provenance === "Vacantless-verified");
}

// --- serviceAreaMatches -----------------------------------------------------
ok("area exact match", serviceAreaMatches("Windsor, ON", "windsor, on"));
ok("area substring match", serviceAreaMatches("Windsor, ON", "Windsor"));
ok("area reverse substring match", serviceAreaMatches("GTA", "Greater GTA region"));
ok("area no match", !serviceAreaMatches("Windsor", "Toronto"));
ok("area null safe", !serviceAreaMatches(null, "Windsor"));
ok("area empty safe", !serviceAreaMatches("Windsor", ""));

// --- rankListings -----------------------------------------------------------
type RankRow = Pick<DirectoryListing, "service_area" | "verified" | "used_count" | "business_name">;
const rows: RankRow[] = [
  { service_area: "Toronto", verified: false, used_count: 10, business_name: "Zeta Far" },
  { service_area: "Windsor, ON", verified: false, used_count: 1, business_name: "Beta Local" },
  { service_area: "Windsor, ON", verified: true, used_count: 0, business_name: "Alpha Local Verified" },
  { service_area: "Windsor, ON", verified: false, used_count: 5, business_name: "Gamma Local" },
];
{
  const ranked = rankListings(rows, "Windsor");
  ok("same-area listings rank above far ones", ranked[3].business_name === "Zeta Far");
  ok("verified ranks first among same-area", ranked[0].business_name === "Alpha Local Verified");
  ok(
    "among same-area unverified, higher used_count wins",
    ranked[1].business_name === "Gamma Local" && ranked[2].business_name === "Beta Local",
  );
  ok("rankListings does not mutate input", rows[0].business_name === "Zeta Far");
}
{
  // No owner area: verified, then used_count, then name.
  const ranked = rankListings(rows, null);
  ok("no-area ranking puts verified first", ranked[0].business_name === "Alpha Local Verified");
  ok("no-area ranking then by used_count", ranked[1].business_name === "Zeta Far");
}
{
  const tie: RankRow[] = [
    { service_area: null, verified: false, used_count: 0, business_name: "Bravo" },
    { service_area: null, verified: false, used_count: 0, business_name: "Alfa" },
  ];
  const ranked = rankListings(tie, null);
  ok("full tie breaks A-Z by name", ranked[0].business_name === "Alfa");
}

// --- Slice 2: promote -> minimize -> validate roundtrip (what the server
//     action promoteTradeToDirectory relies on) -------------------------------
{
  const min = minimizeForDirectory({
    name: "  Dave's Plumbing  ",
    trade_type: "Plumber",
    phone: "519-555-0100",
    email: "dave@example.com",
    note: "Knows the boiler; cash discount", // must NOT survive
    service_area: "Windsor, ON",
  });
  ok("promote: business name trimmed", min.businessName === "Dave's Plumbing");
  ok("promote: service_area carried from promote input", min.serviceArea === "Windsor, ON");
  ok("promote: blurb starts empty", min.blurb === null);
  ok("promote: private note never enters the listing", !("note" in min));

  const check = validateDirectoryListingInput({
    businessName: min.businessName,
    tradeType: min.tradeType,
    serviceArea: min.serviceArea,
    blurb: null,
    phone: min.phone,
    email: min.email,
  });
  ok("promote: minimized row validates", check.ok === true);

  const bad = validateDirectoryListingInput({ businessName: "   " });
  ok("promote: blank business name is rejected", bad.ok === false && bad.code === "business_name");
}

// --- Slice 2: add-to-rolodex reveal (publicListingView on add) --------------
{
  const row: DirectoryListing = {
    id: "x",
    source: "landlord",
    business_name: "Roof Co",
    trade_type: "Roofer",
    service_area: "Windsor, ON",
    blurb: null,
    phone: "519-555-0199",
    email: "roof@example.com",
    contact_public: false,
    verified: false,
    used_count: 2,
  };
  const browseView = publicListingView(row, false);
  ok("browse view hides phone", browseView.phone === null);
  ok("browse view hides email", browseView.email === null);
  const addedView = publicListingView(row, true);
  ok("added view reveals phone", addedView.phone === "519-555-0199");
  ok("added view reveals email", addedView.email === "roof@example.com");
  ok("provenance counts the two landlords", addedView.provenance === "Used by 2 landlords near you");
}

console.log(`\ndirectory: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

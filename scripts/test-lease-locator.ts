// Unit tests for the PURE lease locator (S425 Slice 1a): classify a bundle's
// pages by OREA/RTA form number + title, and window on the actual lease. All
// fixtures are SYNTHETIC (mimicking the real 50 Glenrose bundle structure - RECO
// guide, Form 372 rep agreement, then the Form 400 Agreement to Lease on a later
// page); no real lease text is committed. The real-document validation was a
// one-time local proof (the locator pinned page 19 of that 28-page bundle).
// Run:  npx tsx scripts/test-lease-locator.ts
import {
  classifyLeasePage,
  locateLeasePages,
  leaseAnchorLabel,
  LEASE_WINDOW_PAGES,
} from "../lib/lease-locator";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

// --- classification ---------------------------------------------------------
ok(
  "form 400 -> agreement",
  classifyLeasePage(
    "Form 400 Revised 2026 Page 1 of 5\nAgreement to Lease Residential\nTENANT: LANDLORD: PREMISES RENT",
  ) === "agreement_to_lease",
);
ok(
  "form 400 that REFERENCES the standard lease still -> agreement (form number wins)",
  classifyLeasePage(
    "Form 400 Page 2 of 5 ... enter into the Residential Tenancy Agreement (Standard Form of Lease) ... premises rent",
  ) === "agreement_to_lease",
);
ok(
  "form 372 rep -> other",
  classifyLeasePage(
    "Form 372 Tenant Designated Representation Agreement. lease, agreement to lease or purchase premises",
  ) === "other",
);
ok("RECO guide -> other", classifyLeasePage("RECO INFORMATION GUIDE working with a real estate agent") === "other");
ok(
  "form 324 co-op -> other",
  classifyLeasePage("Form 324 Confirmation of Co-operation and Representation. agreement to lease premises") === "other",
);
ok(
  "standard lease title -> standard",
  classifyLeasePage("Residential Tenancy Agreement (Standard Form of Lease) landlord tenant premises rent") ===
    "standard_lease",
);
ok("form 2229 -> standard", classifyLeasePage("Form 2229E Residential Tenancy Agreement premises tenant landlord rent") === "standard_lease");
ok("blank -> other", classifyLeasePage("") === "other");
ok("bare 'agreement to lease' mention without form body -> other", classifyLeasePage("see the agreement to lease for details") === "other");

// --- a synthetic bundle shaped like the real one ----------------------------
// pages: [RECO guide x2, Form 372 rep x2, Form 400 Agreement to Lease x5, Form 324]
const bundle = [
  "RECO information guide page 1 of 12",
  "RECO information guide page 2 of 12",
  "Form 372 tenant designated representation agreement ... agreement to lease or purchase",
  "Form 372 page 2 of 5 representation agreement commission",
  "Form 400 Agreement to Lease Residential page 1 of 5 tenant landlord premises rent term deposit",
  "Form 400 page 2 of 5 parking additional terms premises rent",
  "Form 400 page 3 of 5 binding agreement premises",
  "Form 400 page 4 of 5 schedule premises rent",
  "Form 400 page 5 of 5 schedule premises",
  "Form 324 confirmation of co-operation and representation",
];
const loc = locateLeasePages(bundle);
console.log("  synthetic bundle located:", loc ? `${leaseAnchorLabel(loc.anchor)} @ page ${loc.startPage + 1}, ${loc.pageCount} pages` : "null");
ok("bundle: locates the Agreement to Lease", loc?.anchor === "agreement_to_lease");
ok("bundle: anchors on page 5 (0-based 4), NOT page 1", loc?.startPage === 4);
ok("bundle: window clamps to remaining pages", loc?.pageCount === Math.min(LEASE_WINDOW_PAGES, bundle.length - 4));
ok("bundle: RECO page not a lease", classifyLeasePage(bundle[0]) === "other");
ok("bundle: Form 372 page not a lease", classifyLeasePage(bundle[2]) === "other");

// --- SELF-SERVE landlord: only the Ontario standard lease, no Form 400 -------
ok(
  "gov standard lease by RTA hallmark -> standard",
  classifyLeasePage(
    "Residential Tenancy Agreement This tenancy agreement is required for tenancies ... Landlord and Tenant Board landlord tenant rent",
  ) === "standard_lease",
);
const selfServe = [
  "Residential Tenancy Agreement (Standard Form of Lease) 1. Parties to this Agreement landlord tenant",
  "page 2 rent lawful rent deposit",
  "page 3 additional terms",
];
const loc0 = locateLeasePages(selfServe);
ok("self-serve lease located at page 1", loc0?.anchor === "standard_lease" && loc0?.startPage === 0);
ok("self-serve window clamps to 3", loc0?.pageCount === 3);

// --- prefer standard lease when both present --------------------------------
const withStandard = [
  "reco guide",
  "Form 400 agreement to lease residential premises tenant rent",
  "Form 2229 residential tenancy agreement (standard form of lease) premises rent",
];
const loc2 = locateLeasePages(withStandard);
ok("prefers standard lease over agreement", loc2?.anchor === "standard_lease" && loc2?.startPage === 2);

// --- CUSTOM landlord agreement (no OREA form, no gov standard lease) ---------
ok(
  "custom lease page -> custom_lease",
  classifyLeasePage(
    "LEASE AGREEMENT This lease is made between the Landlord and the Tenant for monthly rent of $1,500 term of 12 months premises",
  ) === "custom_lease",
);
ok(
  "custom heuristic does NOT fire on a RECO guide",
  classifyLeasePage("RECO information guide landlord tenant rent lease") === "other",
);
const customBundle = [
  "cover letter please find attached",
  "LEASE between Landlord Jane and Tenant Bob. Rent $1,800 monthly. Term of the lease 1 year. premises 9 Main St",
  "page 2 utilities pets",
];
const loc3 = locateLeasePages(customBundle);
ok("custom lease located at page 2", loc3?.anchor === "custom_lease" && loc3?.startPage === 1);

// a recognised OREA form OUTWEIGHS a generic custom page even if the custom page
// appears first (priority, not position).
const customThenForm = [
  "LEASE landlord tenant rent term of the lease premises",
  "Form 400 Agreement to Lease Residential premises tenant landlord rent",
];
ok("recognised form beats a custom page regardless of position", locateLeasePages(customThenForm)?.anchor === "agreement_to_lease");

// --- none found -> null (caller degrades to first pages) --------------------
ok("no lease -> null", locateLeasePages(["reco guide", "Form 372 representation agreement"]) === null);
ok("empty input -> null", locateLeasePages([]) === null);

// --- window never runs past the document end --------------------------------
const shortTail = ["reco", "reco", "Form 400 agreement to lease premises rent tenant", "Form 400 page 2 premises"];
ok("window clamps at doc end", locateLeasePages(shortTail)?.pageCount === 2);

console.log(`\nlease-locator: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

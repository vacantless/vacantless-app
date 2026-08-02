import { toIntakePreview, type IntakeField } from "../lib/intake-preview";
import type { AssetParseResult } from "../lib/asset-capture";
import type { LeaseParseResult } from "../lib/lease-extract";
import type { ListingParseResult } from "../lib/listing-extract";
import type { ParsedListing } from "../lib/mls-import";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function field(fields: IntakeField[], label: string): IntakeField | undefined {
  return fields.find((item) => item.label === label);
}

function lacksConfidence(fields: IntakeField[]): boolean {
  return fields.every((item) => !("confidence" in item));
}

async function main() {
  const leaseResult: LeaseParseResult = {
    ok: true,
    draft: {
      start_date: "2026-09-01",
      end_date: null,
      term_months: 12,
      rent_cents: 285000,
      deposit_cents: null,
      deposit_type: null,
      lease_type: "fixed",
      tenants: [{ name: "Aaliyah Khan", email: null, phone: null }],
      unit_address: "12 Donwoods Dr, Toronto",
      landlord_name: null,
      pets_allowed: null,
      smoking_allowed: false,
      utilities_tenant_pays: "hydro",
      parking: null,
      rent_due_day: 1,
      late_fee: null,
      notes: null,
    },
  };
  const documentPreview = toIntakePreview({
    sourceKind: "document",
    resultKind: "lease",
    result: leaseResult,
  });
  ok("document sourceKind set", documentPreview.sourceKind === "document");
  ok("lease start maps found true", field(documentPreview.fields, "Lease start date")?.found === true);
  ok("lease rent formats from cents", field(documentPreview.fields, "Monthly rent")?.value === "$2,850");
  ok("lease false boolean is surfaced when parser returned it", field(documentPreview.fields, "Smoking allowed")?.value === "No");
  ok("lease null deposit is absent", field(documentPreview.fields, "Deposit") === undefined);
  ok("lease has no public description", documentPreview.publicDescription === null);
  ok("lease confidence omitted", lacksConfidence(documentPreview.fields));

  const listingResult = {
    ok: true,
    draft: {
      address: "95 Prince Arthur Ave",
      rentCents: 310000,
      beds: 2,
      baths: 1.5,
      sqft: null,
      propertyType: null,
      parking: null,
      description: "Bright Annex suite near transit.",
      availableDate: "2026-09-15",
      airConditioning: false,
      balcony: null,
      furnished: null,
      laundry: "in_suite",
      heatIncluded: true,
      hydroIncluded: null,
      waterIncluded: null,
    },
    confidence: "exact",
  } as ListingParseResult & { confidence: "exact" };
  const emailPreview = toIntakePreview({
    sourceKind: "email",
    resultKind: "listing",
    result: listingResult,
  });
  ok("email sourceKind set", emailPreview.sourceKind === "email");
  ok("listing address maps found true", field(emailPreview.fields, "Address")?.found === true);
  ok("listing missing parking is absent", field(emailPreview.fields, "Parking") === undefined);
  ok("listing explicit false maps as No", field(emailPreview.fields, "Air conditioning")?.value === "No");
  ok("listing public description passes through", emailPreview.publicDescription === "Bright Annex suite near transit.");
  ok("unsupported listing confidence is not invented", lacksConfidence(emailPreview.fields));

  const mlsResult: ParsedListing = {
    address: "5 King St W",
    rentCents: 240000,
    beds: 1,
    baths: null,
    sqft: null,
    propertyType: null,
    parking: null,
    description: "Downtown rental with fast subway access.",
    availableDate: null,
    virtualTourUrl: null,
    airConditioning: false,
    balcony: false,
    furnished: false,
    laundry: null,
    heatIncluded: false,
    hydroIncluded: false,
    waterIncluded: false,
    foundFields: ["Address", "Rent", "Beds", "Description"],
  };
  const mlsPreview = toIntakePreview({
    sourceKind: "mls",
    resultKind: "mls",
    result: mlsResult,
  });
  ok("mls sourceKind set", mlsPreview.sourceKind === "mls");
  ok("mls rent maps only when foundFields contains Rent", field(mlsPreview.fields, "Rent")?.value === "$2,400");
  ok("mls default false boolean is not treated as found", field(mlsPreview.fields, "Air conditioning") === undefined);
  ok("mls missing bath is absent", field(mlsPreview.fields, "Baths") === undefined);
  ok("mls public description passes through", mlsPreview.publicDescription === "Downtown rental with fast subway access.");
  ok("mls confidence omitted", lacksConfidence(mlsPreview.fields));

  const assetResult: AssetParseResult = {
    ok: true,
    draft: {
      kind: "plate",
      appliance_type: "fridge",
      make: "Whirlpool",
      model: "WRT311FZDM",
      serial: null,
      install_year: 2024,
      warranty_months: null,
      recommended_consumables: [{ label: "Water filter", interval_months: 6 }],
    },
  };
  const manualPreview = toIntakePreview({
    sourceKind: "manual",
    resultKind: "asset",
    result: assetResult,
  });
  ok("manual sourceKind set", manualPreview.sourceKind === "manual");
  ok("asset make maps found true", field(manualPreview.fields, "Make")?.found === true);
  ok("asset serial missing is absent", field(manualPreview.fields, "Serial") === undefined);
  ok("asset consumable summary maps", field(manualPreview.fields, "Recommended consumables")?.value === "Water filter every 6 months");
  ok("asset has no public description", manualPreview.publicDescription === null);
  ok("asset confidence omitted", lacksConfidence(manualPreview.fields));

  const failedListing: ListingParseResult = { ok: false, reason: "empty" };
  const failedPreview = toIntakePreview({
    sourceKind: "email",
    resultKind: "listing",
    result: failedListing,
  });
  ok("failed parse returns no found fields", failedPreview.fields.length === 0);
  ok("failed parse returns no public description", failedPreview.publicDescription === null);

  console.log(`\nintake-preview: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

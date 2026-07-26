import type { AssetDraft, AssetParseResult, ConsumableRec } from "./asset-capture";
import type { LeaseDraft, LeaseParseResult, LeaseTenant } from "./lease-extract";
import type { ListingDraft, ListingParseResult } from "./listing-extract";
import { FIELD_LABELS, type ParsedListing } from "./mls-import";

export type IntakeSourceKind = "email" | "document" | "mls" | "manual";
export type IntakeFieldConfidence = "exact" | "partial";

export type IntakeField = {
  label: string;
  value: string;
  found: boolean;
  confidence?: IntakeFieldConfidence;
};

export type IntakePreview = {
  fields: IntakeField[];
  publicDescription: string | null;
  sourceKind: IntakeSourceKind;
};

export type IntakePreviewSource =
  | { sourceKind: "document"; resultKind: "lease"; result: LeaseParseResult }
  | { sourceKind: "email"; resultKind: "listing"; result: ListingParseResult }
  | { sourceKind: "mls"; resultKind: "mls"; result: ParsedListing }
  | { sourceKind: "manual"; resultKind: "asset"; result: AssetParseResult };

export function toIntakePreview(source: IntakePreviewSource): IntakePreview {
  switch (source.resultKind) {
    case "lease":
      return {
        fields: source.result.ok ? leaseFields(source.result.draft) : [],
        publicDescription: null,
        sourceKind: source.sourceKind,
      };
    case "listing":
      return {
        fields: source.result.ok ? listingFields(source.result.draft) : [],
        publicDescription: source.result.ok ? source.result.draft.description : null,
        sourceKind: source.sourceKind,
      };
    case "mls":
      return {
        fields: mlsFields(source.result),
        publicDescription: source.result.description,
        sourceKind: source.sourceKind,
      };
    case "asset":
      return {
        fields: source.result.ok ? assetFields(source.result.draft) : [],
        publicDescription: null,
        sourceKind: source.sourceKind,
      };
  }
}

function foundField(label: string, value: string): IntakeField {
  return { label, value, found: true };
}

function addText(fields: IntakeField[], label: string, value: string | null | undefined) {
  if (value) fields.push(foundField(label, value));
}

function addNumber(fields: IntakeField[], label: string, value: number | null | undefined) {
  if (value != null) fields.push(foundField(label, String(value)));
}

function addMoney(fields: IntakeField[], label: string, value: number | null | undefined) {
  if (value != null) fields.push(foundField(label, formatMoneyCents(value)));
}

function addBoolean(fields: IntakeField[], label: string, value: boolean | null | undefined) {
  if (value != null) fields.push(foundField(label, value ? "Yes" : "No"));
}

function leaseFields(draft: LeaseDraft): IntakeField[] {
  const fields: IntakeField[] = [];
  addText(fields, "Lease start date", draft.start_date);
  addText(fields, "Lease end date", draft.end_date);
  if (draft.term_months != null) {
    fields.push(foundField("Lease term", pluralize(draft.term_months, "month")));
  }
  addMoney(fields, "Monthly rent", draft.rent_cents);
  addMoney(fields, "Deposit", draft.deposit_cents);
  addText(fields, "Deposit type", depositTypeLabel(draft.deposit_type));
  addText(fields, "Lease type", leaseTypeLabel(draft.lease_type));
  addText(fields, "Tenants", tenantSummary(draft.tenants));
  addText(fields, "Unit address", draft.unit_address);
  addText(fields, "Landlord", draft.landlord_name);
  addBoolean(fields, "Pets allowed", draft.pets_allowed);
  addBoolean(fields, "Smoking allowed", draft.smoking_allowed);
  addText(fields, "Utilities tenant pays", draft.utilities_tenant_pays);
  addText(fields, "Parking", draft.parking);
  if (draft.rent_due_day != null) {
    fields.push(foundField("Rent due day", `Day ${draft.rent_due_day}`));
  }
  addText(fields, "Late fee", draft.late_fee);
  addText(fields, "Lease notes", draft.notes);
  return fields;
}

function listingFields(draft: ListingDraft): IntakeField[] {
  const fields: IntakeField[] = [];
  addText(fields, "Address", draft.address);
  addMoney(fields, "Rent", draft.rentCents);
  addNumber(fields, "Beds", draft.beds);
  addNumber(fields, "Baths", draft.baths);
  if (draft.sqft != null) fields.push(foundField("Square footage", `${draft.sqft} sq ft`));
  addText(fields, "Parking", draft.parking);
  addText(fields, "Description", draft.description);
  addText(fields, "Available date", draft.availableDate);
  addBoolean(fields, "Air conditioning", draft.airConditioning);
  addBoolean(fields, "Balcony", draft.balcony);
  addBoolean(fields, "Furnished", draft.furnished);
  addText(fields, "Laundry", laundryLabel(draft.laundry));
  addBoolean(fields, "Heat included", draft.heatIncluded);
  addBoolean(fields, "Hydro included", draft.hydroIncluded);
  addBoolean(fields, "Water included", draft.waterIncluded);
  return fields;
}

function mlsFields(parsed: ParsedListing): IntakeField[] {
  const found = new Set(parsed.foundFields);
  const fields: IntakeField[] = [];

  addMlsText(fields, found, "address", parsed.address);
  addMlsMoney(fields, found, "rentCents", parsed.rentCents);
  addMlsNumber(fields, found, "beds", parsed.beds);
  addMlsNumber(fields, found, "baths", parsed.baths);
  if (found.has(FIELD_LABELS.sqft) && parsed.sqft != null) {
    fields.push(foundField(FIELD_LABELS.sqft, `${parsed.sqft} sq ft`));
  }
  addMlsText(fields, found, "parking", parsed.parking);
  addMlsText(fields, found, "description", parsed.description);
  addMlsText(fields, found, "availableDate", parsed.availableDate);
  addMlsText(fields, found, "virtualTourUrl", parsed.virtualTourUrl);
  addMlsBoolean(fields, found, "airConditioning", parsed.airConditioning);
  addMlsBoolean(fields, found, "balcony", parsed.balcony);
  addMlsBoolean(fields, found, "furnished", parsed.furnished);
  if (found.has(FIELD_LABELS.laundry) && parsed.laundry) {
    fields.push(foundField(FIELD_LABELS.laundry, laundryLabel(parsed.laundry) ?? parsed.laundry));
  }
  addMlsBoolean(fields, found, "heatIncluded", parsed.heatIncluded);
  addMlsBoolean(fields, found, "hydroIncluded", parsed.hydroIncluded);
  addMlsBoolean(fields, found, "waterIncluded", parsed.waterIncluded);
  return fields;
}

function assetFields(draft: AssetDraft): IntakeField[] {
  const fields: IntakeField[] = [];
  if (draft.kind === "receipt") {
    addText(fields, "Receipt merchant", draft.merchant);
    addText(fields, "Purchase date", draft.purchase_date);
    addMoney(fields, "Receipt total", draft.total_cents);
  }
  addText(fields, "Appliance type", draft.appliance_type);
  addText(fields, "Make", draft.make);
  addText(fields, "Model", draft.model);
  addText(fields, "Serial", draft.serial);
  if (draft.kind === "plate") {
    addNumber(fields, "Install year", draft.install_year);
    if (draft.warranty_months != null) {
      fields.push(foundField("Warranty", pluralize(draft.warranty_months, "month")));
    }
  }
  addText(fields, "Recommended consumables", consumableSummary(draft.recommended_consumables));
  return fields;
}

function addMlsText<K extends keyof ParsedListing>(
  fields: IntakeField[],
  found: Set<string>,
  key: K,
  value: ParsedListing[K],
) {
  const label = FIELD_LABELS[key as keyof typeof FIELD_LABELS];
  if (label && found.has(label) && typeof value === "string" && value) {
    fields.push(foundField(label, value));
  }
}

function addMlsNumber<K extends keyof ParsedListing>(
  fields: IntakeField[],
  found: Set<string>,
  key: K,
  value: ParsedListing[K],
) {
  const label = FIELD_LABELS[key as keyof typeof FIELD_LABELS];
  if (label && found.has(label) && typeof value === "number") {
    fields.push(foundField(label, String(value)));
  }
}

function addMlsMoney<K extends keyof ParsedListing>(
  fields: IntakeField[],
  found: Set<string>,
  key: K,
  value: ParsedListing[K],
) {
  const label = FIELD_LABELS[key as keyof typeof FIELD_LABELS];
  if (label && found.has(label) && typeof value === "number") {
    fields.push(foundField(label, formatMoneyCents(value)));
  }
}

function addMlsBoolean<K extends keyof ParsedListing>(
  fields: IntakeField[],
  found: Set<string>,
  key: K,
  value: ParsedListing[K],
) {
  const label = FIELD_LABELS[key as keyof typeof FIELD_LABELS];
  if (label && found.has(label) && typeof value === "boolean") {
    fields.push(foundField(label, value ? "Yes" : "No"));
  }
}

function formatMoneyCents(cents: number): string {
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}

function pluralize(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function depositTypeLabel(value: LeaseDraft["deposit_type"]): string | null {
  if (value === "lmr") return "Last month's rent";
  if (value === "security") return "Security deposit";
  return null;
}

function leaseTypeLabel(value: LeaseDraft["lease_type"]): string | null {
  if (value === "fixed") return "Fixed term";
  if (value === "month_to_month") return "Month to month";
  return null;
}

function tenantSummary(tenants: LeaseTenant[]): string | null {
  const rows = tenants
    .map((tenant) => [tenant.name, tenant.email, tenant.phone].filter(Boolean).join(" / "))
    .filter(Boolean);
  return rows.length > 0 ? rows.join("; ") : null;
}

function laundryLabel(value: ListingDraft["laundry"] | ParsedListing["laundry"]): string | null {
  switch (value) {
    case "in_suite":
      return "In-suite laundry";
    case "in_building":
      return "In-building laundry";
    case "shared":
      return "Shared laundry";
    case "none":
      return "No laundry";
    default:
      return null;
  }
}

function consumableSummary(consumables: ConsumableRec[]): string | null {
  if (consumables.length === 0) return null;
  return consumables
    .map((item) => `${item.label} every ${pluralize(item.interval_months, "month")}`)
    .join("; ");
}

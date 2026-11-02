// S743: Ontario Standard Form of Lease (Form 2229E, 2020/12), pure layer.
//
// The lease vault already writes the additional terms (clauses) and signs them.
// Ontario requires the Standard Form for most residential tenancies, so this
// module places the tenancy's facts onto the government's own form. The filler
// (lib/standard-lease-pdf.ts) prints these placements onto the official FLAT
// copy (lib/forms/ontario-2229e-2020-12-flat.pdf, unmodified), and appends the
// Section 15 additional terms as extra pages.
//
// Why the flat copy: the "fillable" 2229E is a dynamic XFA form no PDF library
// can fill, and the static one is encrypted. The flat copy is a plain print
// copy. Box positions come from the static copy's field boxes (read with
// pdf.js, _s743_lease/2229e-field-map.json); pages 1 to 6 line up with the flat
// copy to the pixel. Page 7 (signatures) differs: the flat copy has 1 landlord
// row and 4 tenant rows, measured from the flat page itself.
//
// Pure: no I/O, so every placement is unit-tested (scripts/test-standard-lease.ts).

export type Payer = "landlord" | "tenant" | null;
export type ServiceAnswer = "yes" | "no" | null;
export type LaundryCharge = "no_charge" | "pay_per_use" | null;

/** The details the 2229E asks for that the tenancy does not store. Saved per lease. */
export type StandardLeaseDetails = {
  landlordLegalName?: string | null;
  parking?: string | null;
  isCondo?: boolean | null;
  noticeUnit?: string | null;
  noticeStreetNumber?: string | null;
  noticeStreetName?: string | null;
  noticePoBox?: string | null;
  noticeCity?: string | null;
  noticeProvince?: string | null;
  noticePostalCode?: string | null;
  emailNotices?: boolean | null;
  emailAddresses?: string | null;
  emergencyContact?: boolean | null;
  emergencyContactInfo?: string | null;
  rentDueDay?: string | null; // "first"
  rentPeriod?: "month" | "other" | null;
  rentPeriodOther?: string | null;
  parkingRentCents?: number | null;
  otherCharges?: { label: string; cents: number }[] | null;
  payableTo?: string | null;
  paymentMethods?: string | null;
  partialRentCents?: number | null;
  partialRentPaidOn?: string | null; // ISO
  partialFrom?: string | null; // ISO
  partialTo?: string | null; // ISO
  nsfChargeCents?: number | null;
  gas?: ServiceAnswer;
  airConditioning?: ServiceAnswer;
  storage?: ServiceAnswer;
  laundry?: ServiceAnswer;
  laundryCharge?: LaundryCharge;
  guestParking?: ServiceAnswer;
  guestParkingCharge?: LaundryCharge;
  otherServices?: { label: string; included: ServiceAnswer }[] | null;
  servicesDetails?: string | null;
  electricity?: Payer;
  heat?: Payer;
  water?: Payer;
  utilitiesDetails?: string | null;
  rentDiscount?: string | null; // blank = no discount
  keyDepositCents?: number | null;
  keyDepositDetails?: string | null;
  smokingRules?: string | null; // blank = none
  tenantInsuranceRequired?: boolean | null;
};

export type StandardLeaseInput = {
  landlordName: string;
  tenantNames: string[];
  propertyAddress: string | null;
  startDate: string | null; // ISO
  endDate: string | null; // ISO
  termMonths: number | null;
  rentCents: number | null;
  depositCents: number | null;
  hasAdditionalTerms: boolean;
  details: StandardLeaseDetails;
};

export type Placement =
  | { page: number; kind: "text"; x: number; y: number; w: number; h: number; text: string; multiLine?: boolean }
  | { page: number; kind: "check"; x: number; y: number; w: number; h: number };

export type ParsedAddress = {
  unit: string;
  streetNumber: string;
  streetName: string;
  city: string;
  province: string;
  postalCode: string;
};

const PROVINCES: Record<string, string> = {
  ON: "Ontario", QC: "Quebec", BC: "British Columbia", AB: "Alberta", MB: "Manitoba", SK: "Saskatchewan",
  NS: "Nova Scotia", NB: "New Brunswick", NL: "Newfoundland and Labrador", PE: "Prince Edward Island",
};

/** "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2" -> its parts. Missing parts are "". */
export function parseCanadianAddress(address: string | null | undefined): ParsedAddress {
  const out: ParsedAddress = { unit: "", streetNumber: "", streetName: "", city: "", province: "", postalCode: "" };
  const parts = String(address ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return out;
  const pc = /([A-Za-z]\d[A-Za-z])\s?(\d[A-Za-z]\d)\s*$/;
  // The last part may hold "ON N9A 3E2", or the province and code may be split.
  let last = parts[parts.length - 1];
  const m = pc.exec(last);
  if (m) {
    out.postalCode = `${m[1]} ${m[2]}`.toUpperCase();
    last = last.slice(0, m.index).trim();
    if (last) parts[parts.length - 1] = last;
    else parts.pop();
  }
  const prov = parts.length > 1 ? parts[parts.length - 1].replace(/\.$/, "").trim() : "";
  const provKey = prov.toUpperCase();
  if (PROVINCES[provKey] || Object.values(PROVINCES).some((p) => p.toUpperCase() === provKey)) {
    out.province = PROVINCES[provKey] ?? prov;
    parts.pop();
  }
  const street = parts.shift() ?? "";
  const unitIdx = parts.findIndex((p) => /^(unit|apt\.?|apartment|suite|#)\s*\S+/i.test(p));
  if (unitIdx >= 0) {
    out.unit = parts[unitIdx].replace(/^(unit|apt\.?|apartment|suite|#)\s*/i, "").trim();
    parts.splice(unitIdx, 1);
  }
  out.city = parts.join(", ");
  // "12-34 Main St" (unit-street) or "34 Main St".
  const sm = /^(?:(\w+)\s*-\s*)?(\d+[A-Za-z]?)\s+(.+)$/.exec(street);
  if (sm) {
    if (sm[1] && !out.unit) out.unit = sm[1];
    out.streetNumber = sm[2];
    out.streetName = sm[3];
  } else {
    out.streetName = street;
  }
  return out;
}

/** "Avani Shah" -> { first: "Avani", last: "Shah" }; one word goes in Last Name. */
export function splitName(name: string): { first: string; last: string } {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (w.length <= 1) return { first: "", last: w[0] ?? "" };
  return { first: w.slice(0, -1).join(" "), last: w[w.length - 1] };
}

/** ISO date -> the form's yyyy/mm/dd. */
export function formDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[1]}/${m[2]}/${m[3]}` : "";
}

/** Cents -> "1,095.00" (the form prints the $). */
export function formMoney(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return (Math.round(cents) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// [x1, y1, x2, y2] boxes from the field map (PDF points, origin bottom left).
type Box = [number, number, number, number];
const B = {
  landlord: [39, 450, 591, 462] as Box,
  tenantLast: [[39, 345, 357, 357], [39, 318, 357, 330], [39, 291, 357, 303], [39, 264, 357, 276]] as Box[],
  tenantFirst: [[363, 345, 591, 357], [363, 318, 591, 330], [363, 291, 591, 303], [363, 264, 591, 276]] as Box[],
  unit: [21, 172, 213, 183] as Box,
  streetNo: [219, 172, 303, 183] as Box,
  streetName: [309, 172, 591, 183] as Box,
  city: [21, 145, 303, 156] as Box,
  postal: [507, 145, 591, 156] as Box,
  parking: [21, 102, 590, 125] as Box,
  condoYes: [21, 63, 32, 74] as Box,
  condoNo: [71, 63, 82, 74] as Box,
  // page 2
  nUnit: [21, 707, 105, 718] as Box,
  nStreetNo: [111, 707, 195, 718] as Box,
  nStreetName: [201, 707, 519, 718] as Box,
  nPoBox: [525, 707, 591, 718] as Box,
  nCity: [21, 680, 267, 691] as Box,
  nProvince: [273, 680, 465, 691] as Box,
  nPostal: [471, 680, 591, 691] as Box,
  emailYes: [21, 628, 32, 639] as Box,
  emailNo: [71, 628, 82, 639] as Box,
  email: [21, 593, 591, 609] as Box,
  emergYes: [21, 557, 32, 568] as Box,
  emergNo: [71, 557, 82, 568] as Box,
  emerg: [21, 524, 587, 540] as Box,
  start: [128, 439, 219, 453] as Box,
  fixed: [21, 394, 32, 405] as Box,
  fixedEnd: [183, 392, 274, 408] as Box,
  monthly: [21, 367, 32, 378] as Box,
  otherTerm: [21, 346, 32, 357] as Box,
  otherTermText: [237, 345, 585, 360] as Box,
  dueDay: [151, 256, 256, 277] as Box,
  perMonth: [40, 236, 51, 247] as Box,
  perOther: [40, 216, 51, 227] as Box,
  perOtherText: [153, 213, 504, 231] as Box,
  baseRent: [361, 172, 491, 187] as Box,
  parkingRent: [361, 154, 491, 169] as Box,
  otherLabel: [[75, 113, 353, 135], [75, 90, 353, 113], [75, 68, 353, 90]] as Box[],
  otherCost: [[361, 114, 491, 133], [361, 92, 491, 111], [361, 70, 491, 89]] as Box[],
  total: [361, 52, 491, 67] as Box,
  // page 3
  payableTo: [21, 693, 587, 713] as Box,
  methods: [21, 650, 587, 670] as Box,
  partialAmount: [445, 581, 553, 597] as Box,
  partialPaidOn: [40, 558, 123, 576] as Box,
  partialFrom: [352, 556, 437, 576] as Box,
  partialTo: [456, 556, 542, 576] as Box,
  nsf: [158, 501, 266, 520] as Box,
  svcYes: [[342, 389, 353, 400], [342, 368, 353, 378], [342, 346, 353, 357], [342, 324, 353, 335], [342, 303, 353, 314]] as Box[],
  svcNo: [[385, 389, 396, 400], [385, 368, 396, 378], [385, 346, 396, 357], [385, 324, 396, 335], [385, 303, 396, 314]] as Box[],
  laundryNoCharge: [421, 324, 432, 335] as Box,
  laundryPayPerUse: [493, 324, 504, 335] as Box,
  guestNoCharge: [421, 303, 432, 314] as Box,
  guestPayPerUse: [493, 303, 504, 314] as Box,
  otherSvcLabel: [[68, 282, 321, 295], [68, 261, 321, 273], [68, 239, 321, 251]] as Box[],
  otherSvcYes: [[342, 281, 353, 292], [342, 260, 353, 270], [342, 238, 353, 249]] as Box[],
  otherSvcNo: [[385, 281, 396, 292], [385, 260, 396, 270], [385, 238, 396, 249]] as Box[],
  svcDetails: [21, 67, 589, 191] as Box,
  // page 4
  utilLandlord: [[75, 728, 86, 739], [75, 706, 86, 717], [75, 685, 86, 696]] as Box[],
  utilTenant: [[147, 728, 158, 739], [147, 706, 158, 717], [147, 685, 158, 696]] as Box[],
  utilDetails: [21, 537, 588, 647] as Box,
  noDiscount: [21, 470, 32, 481] as Box,
  discount: [21, 431, 32, 442] as Box,
  discountText: [21, 339, 589, 414] as Box,
  noDeposit: [21, 232, 32, 243] as Box,
  deposit: [21, 193, 32, 204] as Box,
  depositAmount: [206, 192, 302, 204] as Box,
  // page 5
  noKeyDeposit: [21, 713, 32, 724] as Box,
  keyDeposit: [21, 677, 32, 688] as Box,
  keyDepositAmount: [253, 676, 350, 688] as Box,
  keyDepositText: [21, 565, 589, 639] as Box,
  noSmokingRules: [21, 430, 32, 441] as Box,
  smokingRules: [21, 394, 32, 405] as Box,
  smokingText: [21, 302, 589, 371] as Box,
  noInsurance: [21, 180, 32, 191] as Box,
  insurance: [21, 145, 32, 156] as Box,
  // page 6
  noTerms: [21, 195, 32, 206] as Box,
  terms: [21, 153, 32, 164] as Box,
  // page 7 (flat copy rows, measured): name / signature / date columns
  sigLandlordName: [21, 623, 249, 648] as Box,
  sigTenantName: [[21, 537, 249, 562], [21, 497, 249, 522], [21, 457, 249, 482], [21, 418, 249, 443]] as Box[],
};

export const SIGNATURE_BOXES = {
  landlord: { name: [21, 623, 249, 648], signature: [255, 623, 465, 648], date: [471, 623, 591, 648] },
  tenants: [537, 497, 457, 418].map((y) => ({
    name: [21, y, 249, y + 25], signature: [255, y, 465, y + 25], date: [471, y, 591, y + 25],
  })),
} as const;

/** The form has room for 4 tenants and 3 other charges; the rest go on the extra page. */
export const FORM_TENANT_ROWS = 4;

function t(page: number, b: Box, text: string | null | undefined, multiLine = false): Placement[] {
  const s = String(text ?? "").trim();
  if (!s) return [];
  return [{ page, kind: "text", x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1], text: s, multiLine }];
}
function c(page: number, b: Box, on: boolean | null | undefined): Placement[] {
  return on ? [{ page, kind: "check", x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] }] : [];
}
function yesNo(page: number, yes: Box, no: Box, v: boolean | ServiceAnswer | undefined): Placement[] {
  if (v === true || v === "yes") return c(page, yes, true);
  if (v === false || v === "no") return c(page, no, true);
  return [];
}

/** Every value to print on the form, by page and box. */
export function standardLeasePlacements(input: StandardLeaseInput): Placement[] {
  const d = input.details ?? {};
  const out: Placement[] = [];
  const a = parseCanadianAddress(input.propertyAddress);

  // Section 1: parties
  out.push(...t(1, B.landlord, d.landlordLegalName?.trim() || input.landlordName));
  input.tenantNames.slice(0, FORM_TENANT_ROWS).forEach((n, i) => {
    const s = splitName(n);
    out.push(...t(1, B.tenantLast[i], s.last), ...t(1, B.tenantFirst[i], s.first));
  });
  // Section 2: rental unit
  out.push(
    ...t(1, B.unit, a.unit), ...t(1, B.streetNo, a.streetNumber), ...t(1, B.streetName, a.streetName),
    // Province is pre-printed "Ontario" on the form, so it is not printed again.
    ...t(1, B.city, a.city), ...t(1, B.postal, a.postalCode),
    ...t(1, B.parking, d.parking, true), ...yesNo(1, B.condoYes, B.condoNo, d.isCondo),
  );
  // Section 3: contact information
  out.push(
    ...t(2, B.nUnit, d.noticeUnit), ...t(2, B.nStreetNo, d.noticeStreetNumber), ...t(2, B.nStreetName, d.noticeStreetName),
    ...t(2, B.nPoBox, d.noticePoBox), ...t(2, B.nCity, d.noticeCity), ...t(2, B.nProvince, d.noticeProvince),
    ...t(2, B.nPostal, d.noticePostalCode),
    ...yesNo(2, B.emailYes, B.emailNo, d.emailNotices),
    ...(d.emailNotices ? t(2, B.email, d.emailAddresses) : []),
    ...yesNo(2, B.emergYes, B.emergNo, d.emergencyContact),
    ...(d.emergencyContact ? t(2, B.emerg, d.emergencyContactInfo) : []),
  );
  // Section 4: term
  out.push(...t(2, B.start, formDate(input.startDate)));
  if (input.endDate) out.push(...c(2, B.fixed, true), ...t(2, B.fixedEnd, formDate(input.endDate)));
  else out.push(...c(2, B.monthly, true));
  // Section 5: rent
  out.push(...t(2, B.dueDay, d.rentDueDay || "first"));
  if (d.rentPeriod === "other") out.push(...c(2, B.perOther, true), ...t(2, B.perOtherText, d.rentPeriodOther));
  else out.push(...c(2, B.perMonth, true));
  out.push(...t(2, B.baseRent, formMoney(input.rentCents)));
  if (d.parkingRentCents) out.push(...t(2, B.parkingRent, formMoney(d.parkingRentCents)));
  const others = (d.otherCharges ?? []).filter((o) => o.label?.trim() && o.cents > 0).slice(0, 3);
  others.forEach((o, i) => out.push(...t(2, B.otherLabel[i], o.label), ...t(2, B.otherCost[i], formMoney(o.cents))));
  const allOthers = (d.otherCharges ?? []).filter((o) => o.label?.trim() && o.cents > 0);
  const total = (input.rentCents ?? 0) + (d.parkingRentCents ?? 0) + allOthers.reduce((s, o) => s + o.cents, 0);
  if (input.rentCents != null) out.push(...t(2, B.total, formMoney(total)));
  out.push(...t(3, B.payableTo, d.payableTo || d.landlordLegalName || input.landlordName));
  out.push(...t(3, B.methods, d.paymentMethods));
  if (d.partialRentCents) {
    out.push(
      ...t(3, B.partialAmount, formMoney(d.partialRentCents)), ...t(3, B.partialPaidOn, formDate(d.partialRentPaidOn)),
      ...t(3, B.partialFrom, formDate(d.partialFrom)), ...t(3, B.partialTo, formDate(d.partialTo)),
    );
  }
  if (d.nsfChargeCents) out.push(...t(3, B.nsf, formMoney(d.nsfChargeCents)));
  // Section 6: services and utilities
  const svc: ServiceAnswer[] = [d.gas ?? null, d.airConditioning ?? null, d.storage ?? null, d.laundry ?? null, d.guestParking ?? null];
  svc.forEach((v, i) => out.push(...yesNo(3, B.svcYes[i], B.svcNo[i], v)));
  if (d.laundry === "yes") {
    out.push(...c(3, B.laundryNoCharge, d.laundryCharge === "no_charge"), ...c(3, B.laundryPayPerUse, d.laundryCharge === "pay_per_use"));
  }
  if (d.guestParking === "yes") {
    out.push(...c(3, B.guestNoCharge, d.guestParkingCharge === "no_charge"), ...c(3, B.guestPayPerUse, d.guestParkingCharge === "pay_per_use"));
  }
  (d.otherServices ?? []).filter((o) => o.label?.trim()).slice(0, 3).forEach((o, i) => {
    out.push(...t(3, B.otherSvcLabel[i], o.label), ...yesNo(3, B.otherSvcYes[i], B.otherSvcNo[i], o.included));
  });
  out.push(...t(3, B.svcDetails, d.servicesDetails, true));
  ([d.electricity, d.heat, d.water] as Payer[]).forEach((p, i) => {
    out.push(...c(4, B.utilLandlord[i], p === "landlord"), ...c(4, B.utilTenant[i], p === "tenant"));
  });
  out.push(...t(4, B.utilDetails, d.utilitiesDetails, true));
  // Section 7: rent discounts
  if (d.rentDiscount?.trim()) out.push(...c(4, B.discount, true), ...t(4, B.discountText, d.rentDiscount, true));
  else out.push(...c(4, B.noDiscount, true));
  // Section 8: rent deposit
  if (input.depositCents && input.depositCents > 0) out.push(...c(4, B.deposit, true), ...t(4, B.depositAmount, formMoney(input.depositCents)));
  else out.push(...c(4, B.noDeposit, true));
  // Section 9: key deposit
  if (d.keyDepositCents && d.keyDepositCents > 0) {
    out.push(...c(5, B.keyDeposit, true), ...t(5, B.keyDepositAmount, formMoney(d.keyDepositCents)), ...t(5, B.keyDepositText, d.keyDepositDetails, true));
  } else out.push(...c(5, B.noKeyDeposit, true));
  // Section 10: smoking
  if (d.smokingRules?.trim()) out.push(...c(5, B.smokingRules, true), ...t(5, B.smokingText, d.smokingRules, true));
  else out.push(...c(5, B.noSmokingRules, true));
  // Section 11: tenant insurance
  out.push(...yesNo(5, B.insurance, B.noInsurance, d.tenantInsuranceRequired));
  // Section 15: additional terms
  out.push(...c(6, input.hasAdditionalTerms ? B.terms : B.noTerms, true));
  // Section 17: printed names on the signature rows
  out.push(...t(7, B.sigLandlordName, d.landlordLegalName?.trim() || input.landlordName));
  input.tenantNames.slice(0, FORM_TENANT_ROWS).forEach((n, i) => out.push(...t(7, B.sigTenantName[i], n)));
  return out;
}

/** What the landlord still has to answer before the form is complete. */
export function standardLeaseMissing(input: StandardLeaseInput): string[] {
  const d = input.details ?? {};
  const miss: string[] = [];
  if (input.tenantNames.length === 0) miss.push("at least one tenant");
  if (!input.propertyAddress) miss.push("the rental address");
  if (!input.startDate) miss.push("the start date");
  if (input.rentCents == null) miss.push("the rent");
  if (d.isCondo == null) miss.push("whether the unit is in a condominium");
  if (!d.noticeStreetName?.trim() && !d.noticePoBox?.trim()) miss.push("the landlord's address for notices");
  if (d.emailNotices == null) miss.push("whether notices can go by email");
  if (d.emergencyContact == null) miss.push("whether you give an emergency contact");
  if (!d.paymentMethods?.trim()) miss.push("how rent is paid");
  if (d.electricity == null || d.heat == null || d.water == null) miss.push("who pays electricity, heat and water");
  if ([d.gas, d.airConditioning, d.storage, d.laundry, d.guestParking].some((v) => v == null)) miss.push("which services are included");
  if (d.tenantInsuranceRequired == null) miss.push("whether tenant insurance is required");
  return miss;
}

/** Lines for the extra page: tenants past row 4 and charges past row 3. */
export function overflowLines(input: StandardLeaseInput): string[] {
  const lines: string[] = [];
  const extraTenants = input.tenantNames.slice(FORM_TENANT_ROWS);
  if (extraTenants.length) lines.push(`Section 1, more tenants: ${extraTenants.join("; ")}.`);
  const extraCharges = (input.details.otherCharges ?? []).filter((o) => o.label?.trim() && o.cents > 0).slice(3);
  if (extraCharges.length) {
    lines.push(`Section 5, more charges: ${extraCharges.map((o) => `${o.label} $${formMoney(o.cents)}`).join("; ")}.`);
  }
  return lines;
}

/** The 2229E is Ontario's form. A rental with no province in its address counts as Ontario. */
export function isOntarioRental(address: string | null | undefined): boolean {
  const prov = parseCanadianAddress(address).province;
  return prov === "" || prov === "Ontario";
}

/** Values the form's own notes forbid. Shown above the download. */
export function standardLeaseProblems(input: StandardLeaseInput): string[] {
  const d = input.details ?? {};
  const out: string[] = [];
  if ((d.nsfChargeCents ?? 0) > 2000) out.push("The NSF administration charge cannot be more than $20.00 (Section 5f).");
  if (input.depositCents && input.rentCents != null && input.depositCents > input.rentCents) {
    out.push("The rent deposit cannot be more than one month's rent (Section 8).");
  }
  if (d.emailNotices && !d.emailAddresses?.trim()) out.push("Add the email addresses for notices (Section 3).");
  return out;
}

/** "$1,095.50" -> 109550; blank or junk -> null. */
export function parseMoneyCents(v: string | null | undefined): number | null {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** The details form (standard/page.tsx) -> StandardLeaseDetails. Unknown answers stay null. */
export function detailsFromForm(get: (name: string) => string | null): StandardLeaseDetails {
  const str = (n: string) => { const v = String(get(n) ?? "").trim(); return v ? v.slice(0, 600) : null; };
  const yn = (n: string): boolean | null => (get(n) === "yes" ? true : get(n) === "no" ? false : null);
  const svc = (n: string): ServiceAnswer => (get(n) === "yes" ? "yes" : get(n) === "no" ? "no" : null);
  const payer = (n: string): Payer => (get(n) === "landlord" ? "landlord" : get(n) === "tenant" ? "tenant" : null);
  const charge = (n: string): LaundryCharge => (get(n) === "no_charge" ? "no_charge" : get(n) === "pay_per_use" ? "pay_per_use" : null);
  const otherCharges = [1, 2, 3, 4]
    .map((i) => ({ label: str(`charge${i}_label`) ?? "", cents: parseMoneyCents(get(`charge${i}_amount`)) ?? 0 }))
    .filter((o) => o.label && o.cents > 0);
  const otherServices = [1, 2, 3]
    .map((i) => ({ label: str(`service${i}_label`) ?? "", included: svc(`service${i}_included`) }))
    .filter((o) => o.label);
  return {
    landlordLegalName: str("landlord_legal_name"),
    parking: str("parking"),
    isCondo: yn("is_condo"),
    noticeUnit: str("notice_unit"),
    noticeStreetNumber: str("notice_street_number"),
    noticeStreetName: str("notice_street_name"),
    noticePoBox: str("notice_po_box"),
    noticeCity: str("notice_city"),
    noticeProvince: str("notice_province"),
    noticePostalCode: str("notice_postal_code"),
    emailNotices: yn("email_notices"),
    emailAddresses: str("email_addresses"),
    emergencyContact: yn("emergency_contact"),
    emergencyContactInfo: str("emergency_contact_info"),
    rentDueDay: str("rent_due_day"),
    rentPeriod: get("rent_period") === "other" ? "other" : "month",
    rentPeriodOther: str("rent_period_other"),
    parkingRentCents: parseMoneyCents(get("parking_rent")),
    otherCharges,
    payableTo: str("payable_to"),
    paymentMethods: str("payment_methods"),
    partialRentCents: parseMoneyCents(get("partial_rent")),
    partialRentPaidOn: str("partial_paid_on"),
    partialFrom: str("partial_from"),
    partialTo: str("partial_to"),
    nsfChargeCents: parseMoneyCents(get("nsf_charge")),
    gas: svc("gas"),
    airConditioning: svc("air_conditioning"),
    storage: svc("storage"),
    laundry: svc("laundry"),
    laundryCharge: charge("laundry_charge"),
    guestParking: svc("guest_parking"),
    guestParkingCharge: charge("guest_parking_charge"),
    otherServices,
    servicesDetails: str("services_details"),
    electricity: payer("electricity"),
    heat: payer("heat"),
    water: payer("water"),
    utilitiesDetails: str("utilities_details"),
    rentDiscount: str("rent_discount"),
    keyDepositCents: parseMoneyCents(get("key_deposit")),
    keyDepositDetails: str("key_deposit_details"),
    smokingRules: str("smoking_rules"),
    tenantInsuranceRequired: yn("tenant_insurance"),
  };
}

/** The last saved details for this landlord, as a starting point for a new lease. */
export function carryForwardDetails(prev: StandardLeaseDetails | null | undefined): StandardLeaseDetails {
  if (!prev) return {};
  // Rental-specific answers (parking, partial rent) do not carry; the landlord's do.
  const { parking: _p, partialRentCents: _a, partialRentPaidOn: _b, partialFrom: _c, partialTo: _d, ...rest } = prev;
  return rest;
}

// ---------------------------------------------------------------------------
// S744c: Section 17 signatures. Each SIGNED lease_signers row is drawn on page
// 7 in its own row: the landlord row for the landlord, and for a tenant the
// row whose printed name matches theirs (else the next free row). A typed
// signature prints as text; a drawn one is its PNG. The date is the day it was
// signed, in Toronto.
// ---------------------------------------------------------------------------

export type SignedSigner = {
  role: string; // landlord | tenant | guarantor
  name: string | null;
  signedName: string | null;
  kind: "typed" | "drawn" | null;
  data: string | null;
  signedAt: string | null;
  signOrder: number;
};

export type SignaturePlacement = {
  page: 7;
  row: "landlord" | number; // tenant row index 0..3
  box: Box;
  dateBox: Box;
  kind: "typed" | "drawn";
  data: string; // the typed text, or a PNG data: URL
  dateText: string;
};

const normName = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** "2026/11/02" (the form's yyyy/mm/dd) for an ISO instant, as the calendar day in Toronto. */
export function torontoDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d).replace(/-/g, "/");
}

function usablePng(data: string | null | undefined): boolean {
  return typeof data === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data) && data.length < 2_000_000;
}

/** Where each signed signature goes. Unsigned rows stay blank for wet ink. */
export function signaturePlacements(tenantNames: string[], signers: SignedSigner[]): {
  placed: SignaturePlacement[];
  /** Signed tenants with no row of their own on the form (more than 4, or a name that matches no row). */
  overflow: SignedSigner[];
} {
  const placed: SignaturePlacement[] = [];
  const overflow: SignedSigner[] = [];
  // All four rows exist on the form, named or not.
  const rows = Array.from({ length: FORM_TENANT_ROWS }, (_, i) => normName(tenantNames[i]));
  const taken = new Set<number>();
  const signed = signers
    .filter((s) => s.signedAt && s.data && (s.kind === "typed" || s.kind === "drawn"))
    .slice()
    .sort((a, b) => a.signOrder - b.signOrder);

  const make = (s: SignedSigner, row: "landlord" | number, box: { signature: readonly number[]; date: readonly number[] }): SignaturePlacement | null => {
    if (s.kind === "drawn" && !usablePng(s.data)) return null;
    const text = s.kind === "typed" ? String(s.data).trim() : String(s.data);
    if (!text) return null;
    return {
      page: 7, row,
      box: [box.signature[0], box.signature[1], box.signature[2], box.signature[3]],
      dateBox: [box.date[0], box.date[1], box.date[2], box.date[3]],
      kind: s.kind as "typed" | "drawn",
      data: text,
      dateText: torontoDay(s.signedAt),
    };
  };

  for (const s of signed) {
    if (s.role === "landlord") {
      if (placed.some((p) => p.row === "landlord")) continue;
      const p = make(s, "landlord", SIGNATURE_BOXES.landlord);
      if (p) placed.push(p);
      continue;
    }
    if (s.role !== "tenant") continue;
    let idx = rows.findIndex((n, i) => !taken.has(i) && n !== "" && (n === normName(s.name) || n === normName(s.signedName)));
    // Else the first free row with no printed name. Never a row printed with
    // someone else's name: an unmatched signer is listed on the attachment.
    if (idx < 0) idx = rows.findIndex((n, i) => !taken.has(i) && n === "");
    if (idx < 0) { overflow.push(s); continue; }
    const p = make(s, idx, SIGNATURE_BOXES.tenants[idx]);
    if (p) { taken.add(idx); placed.push(p); }
  }
  return { placed, overflow };
}

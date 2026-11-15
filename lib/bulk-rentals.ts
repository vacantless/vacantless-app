// ============================================================================
// bulk-rentals (S799d). Read many rentals from rows pasted out of a
// spreadsheet, or from a CSV file, so a landlord with 5 to 75 rentals does not
// type each one. Pure: no database, no network. The page previews these rows
// and the server action reads the same text again before saving anything.
// ============================================================================

export const BULK_RENTALS_MAX_ROWS = 200;

export type BulkRentalRow = {
  line: number; // 1-based line in the pasted text
  address: string | null; // street address with the unit folded in
  rentCents: number | null;
  beds: number | null;
  baths: number | null;
  tenantName: string | null;
  tenantEmail: string | null;
  tenantPhone: string | null;
  leaseStart: string | null; // YYYY-MM-DD
  leaseEnd: string | null; // YYYY-MM-DD
  problems: string[]; // the row is not saved while this has any entry
  notes: string[]; // saved, with something the landlord should know
};

export type BulkRentalsResult = {
  rows: BulkRentalRow[];
  hadHeader: boolean;
  unreadColumns: string[]; // header names we did not recognise
  tooMany: boolean;
};

type Field =
  | "address"
  | "unit"
  | "city"
  | "province"
  | "postal"
  | "rent"
  | "beds"
  | "baths"
  | "tenantName"
  | "tenantEmail"
  | "tenantPhone"
  | "leaseStart"
  | "leaseEnd";

// Header words a landlord's own sheet is likely to use. Compared after
// lower-casing and stripping everything but letters and digits.
const HEADER_WORDS: Record<Field, string[]> = {
  address: ["address", "streetaddress", "street", "property", "propertyaddress", "rental", "building", "location"],
  unit: ["unit", "unitnumber", "unitno", "apt", "apartment", "suite", "unitnum"],
  city: ["city", "town"],
  province: ["province", "prov", "state"],
  postal: ["postalcode", "postal", "zip", "zipcode"],
  rent: ["rent", "monthlyrent", "currentrent", "rentamount", "rentmo", "price", "amount"],
  beds: ["beds", "bed", "bedrooms", "bedroom", "br", "bdrm", "bdrms"],
  baths: ["baths", "bath", "bathrooms", "bathroom", "ba"],
  tenantName: ["tenant", "tenantname", "name", "tenants", "resident", "residentname", "renter", "occupant"],
  tenantEmail: ["email", "tenantemail", "emailaddress", "residentemail"],
  tenantPhone: ["phone", "tenantphone", "phonenumber", "cell", "mobile", "residentphone"],
  leaseStart: ["leasestart", "start", "startdate", "leasestartdate", "movein", "moveindate", "leasefrom", "from"],
  leaseEnd: ["leaseend", "end", "enddate", "leaseenddate", "leaseto", "to", "expiry", "leaseexpiry", "expires"],
};

function key(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fieldForHeader(raw: string): Field | null {
  const k = key(raw);
  if (!k) return null;
  for (const f of Object.keys(HEADER_WORDS) as Field[]) {
    if (HEADER_WORDS[f].includes(k)) return f;
  }
  return null;
}

// One line of CSV, honouring double quotes ("" is a quote inside a quoted cell).
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  out.push(cell);
  return out;
}

function splitLine(line: string, tabbed: boolean): string[] {
  const cells = tabbed ? line.split("\t") : splitCsvLine(line);
  return cells.map((c) => c.trim());
}

export function parseMoneyCents(raw: string | null | undefined): number | null {
  const v = (raw ?? "").replace(/[^0-9.]/g, "");
  if (!v) return null;
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

// "2", "2 bed", "2.5", "1+1" (bedroom plus den reads as the first number),
// "studio" and "bachelor" (0 bedrooms).
export function parseCount(raw: string | null | undefined): number | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (/^(studio|bachelor)\b/.test(v)) return 0;
  const m = v.match(/\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number.parseFloat(m[0]);
  return Number.isFinite(n) && n >= 0 && n < 50 ? n : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// 2026-02-01, 2026/2/1, 2/1/2026 (month first, as Canadian sheets from Excel
// usually are; a first number above 12 is read as the day), Feb 1 2026,
// 1 Feb 2026.
export function parseSheetDate(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!v) return null;
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    return a > 12 ? iso(+m[3], b, a) : iso(+m[3], a, b);
  }
  m = v.match(/^([a-z]{3})[a-z]* (\d{1,2})(?:st|nd|rd|th)? (\d{4})$/);
  if (m && MONTHS.includes(m[1])) return iso(+m[3], MONTHS.indexOf(m[1]) + 1, +m[2]);
  m = v.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3})[a-z]* (\d{4})$/);
  if (m && MONTHS.includes(m[2])) return iso(+m[3], MONTHS.indexOf(m[2]) + 1, +m[1]);
  return null;
}

// "12 King St" + unit "3" -> "12 King St, Unit 3". A unit already written in
// the address is left alone.
export function joinAddress(parts: {
  address: string;
  unit?: string;
  city?: string;
  province?: string;
  postal?: string;
}): string {
  let out = parts.address.trim().replace(/\s+/g, " ");
  const unit = (parts.unit ?? "").trim().replace(/^#/, "");
  if (unit && !/\b(unit|apt|apartment|suite|ste)\b|#/i.test(out)) {
    const label = /^(unit|apt|apartment|suite|ste|main|upper|lower|basement|rear|front)\b/i.test(unit)
      ? unit
      : `Unit ${unit}`;
    out = `${out}, ${label}`;
  }
  const lower = out.toLowerCase();
  for (const extra of [parts.city, parts.province, parts.postal]) {
    const e = (extra ?? "").trim();
    if (e && !lower.includes(e.toLowerCase())) out = `${out}, ${e}`;
  }
  return out;
}

// Same rental written two ways should match: case, punctuation and spacing.
export function addressKey(address: string): string {
  return address
    .toLowerCase()
    .replace(/\b(apartment|apt|suite|ste)\b/g, "unit")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\broad\b/g, "rd")
    .replace(/\bdrive\b/g, "dr")
    .replace(/[^a-z0-9]/g, "");
}

const POSITIONAL: Field[] = ["address", "rent", "beds", "baths", "tenantName", "tenantEmail", "tenantPhone", "leaseStart", "leaseEnd"];

export function parseBulkRentals(
  text: string,
  opts: { existingAddresses?: readonly string[] } = {},
): BulkRentalsResult {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l, i) => ({ l, line: i + 1 }))
    .filter((x) => x.l.trim() !== "");
  if (lines.length === 0) return { rows: [], hadHeader: false, unreadColumns: [], tooMany: false };

  const tabbed = lines.some((x) => x.l.includes("\t"));
  const first = splitLine(lines[0].l, tabbed);
  const headerFields = first.map(fieldForHeader);
  // A header row names at least an address column and has no dollar figure.
  const hadHeader = headerFields.includes("address") && !first.some((c) => /\d{3,}/.test(c));
  const columns: (Field | null)[] = hadHeader ? headerFields : first.map((_, i) => POSITIONAL[i] ?? null);
  const unreadColumns = hadHeader ? first.filter((c, i) => c && headerFields[i] == null) : [];
  const body = hadHeader ? lines.slice(1) : lines;
  const tooMany = body.length > BULK_RENTALS_MAX_ROWS;

  const seen = new Set((opts.existingAddresses ?? []).map(addressKey));
  const inThisPaste = new Set<string>();
  const rows: BulkRentalRow[] = [];

  for (const { l, line } of body.slice(0, BULK_RENTALS_MAX_ROWS)) {
    const cells = splitLine(l, tabbed);
    const raw: Partial<Record<Field, string>> = {};
    columns.forEach((f, i) => {
      // The first column that names a field wins (two "Name" columns happen).
      if (f && raw[f] == null && cells[i]) raw[f] = cells[i];
    });
    // A header repeated partway down a long sheet is skipped, not saved.
    if (raw.address && fieldForHeader(raw.address) === "address") continue;

    const problems: string[] = [];
    const notes: string[] = [];
    const address = raw.address
      ? joinAddress({ address: raw.address, unit: raw.unit, city: raw.city, province: raw.province, postal: raw.postal })
      : null;
    if (!address) problems.push("No address");
    else if (!/\d/.test(address)) problems.push("Address has no street number");

    if (address) {
      const k = addressKey(address);
      if (seen.has(k)) problems.push("You already have this rental");
      else if (inThisPaste.has(k)) problems.push("Same address as a row above");
      inThisPaste.add(k);
    }

    const rentCents = parseMoneyCents(raw.rent);
    if (raw.rent && rentCents == null) notes.push("Could not read the rent");
    const beds = parseCount(raw.beds);
    const baths = parseCount(raw.baths);

    const tenantName = raw.tenantName?.trim() || null;
    const tenantEmail = raw.tenantEmail && /^\S+@\S+\.\S+$/.test(raw.tenantEmail) ? raw.tenantEmail.toLowerCase() : null;
    if (raw.tenantEmail && !tenantEmail) notes.push("Could not read the email");
    const tenantPhone = raw.tenantPhone?.trim() || null;
    const leaseStart = parseSheetDate(raw.leaseStart);
    let leaseEnd = parseSheetDate(raw.leaseEnd);
    if (raw.leaseStart && !leaseStart) notes.push("Could not read the lease start");
    if (leaseStart && leaseEnd && leaseEnd < leaseStart) {
      leaseEnd = null;
      notes.push("Lease end is before the start, left blank");
    }
    if (tenantName && !leaseStart) notes.push("No lease start date. Saved as rented. Add the tenant later.");

    rows.push({
      line,
      address,
      rentCents,
      beds,
      baths,
      tenantName,
      tenantEmail,
      tenantPhone,
      leaseStart,
      leaseEnd,
      problems,
      notes,
    });
  }

  return { rows, hadHeader, unreadColumns, tooMany };
}

export type BulkRentalsSummary = { ready: number; skipped: number; withTenancy: number; leasedNoTenancy: number; drafts: number };

export function summarizeBulkRentals(rows: readonly BulkRentalRow[]): BulkRentalsSummary {
  const good = rows.filter((r) => r.problems.length === 0);
  const withTenancy = good.filter((r) => r.tenantName && r.leaseStart).length;
  const leasedNoTenancy = good.filter((r) => r.tenantName && !r.leaseStart).length;
  return {
    ready: good.length,
    skipped: rows.length - good.length,
    withTenancy,
    leasedNoTenancy,
    drafts: good.length - withTenancy - leasedNoTenancy,
  };
}

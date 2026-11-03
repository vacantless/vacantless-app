// lib/standard-lease-tool.ts (S746c). The free public Ontario Standard Lease tool.
//
// Engine 1 of the subscriber plan, tool 2. Every private residential tenancy in
// Ontario since 2018 uses the government's Standard Form of Lease (2229E), and
// landlords search for it on every new tenancy. The signed-in product already
// fills the real form (lib/standard-lease-pdf.ts) from a tenancy plus the
// details form (lib/standard-lease.ts detailsFromForm). This module reads the
// same form fields plus the tenancy basics from a plain POST, so a stranger can
// fill the form with nothing stored.
//
// PURE: no I/O. Tests: scripts/test-standard-lease-tool.ts.

import {
  detailsFromForm,
  parseMoneyCents,
  standardLeaseMissing,
  standardLeaseProblems,
  type StandardLeaseInput,
} from "./standard-lease";
import { parseISODate } from "./proration";

export const LEASE_TOOL_PATH = "/tools/standard-lease";
export const LEASE_TOOL_SIGNUP_HREF =
  "/signup?utm_source=vacantless&utm_medium=tool&utm_campaign=standard-lease";

const MAX_TENANTS = 6;
const MAX_TEXT = 200;
const MAX_TERMS = 6000;

export type LeaseToolOutcome = {
  input: StandardLeaseInput;
  additionalTerms: string | null;
  /** Answers the form needs that were left blank (the form prints anyway). */
  missing: string[];
  /** Values the form's own notes forbid (the PDF is refused). */
  problems: string[];
};

function cleanText(v: string | null | undefined, max = MAX_TEXT): string {
  if (v == null) return "";
  return String(v)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);
}

function isoOrNull(v: string | null | undefined): string | null {
  const s = cleanText(v, 10);
  return parseISODate(s) ? s : null;
}

/** Read the whole tool form. `get` returns one field's value or null. */
export function leaseToolFromForm(get: (name: string) => string | null): LeaseToolOutcome {
  const tenantNames: string[] = [];
  for (let i = 1; i <= MAX_TENANTS; i++) {
    const n = cleanText(get(`tenant${i}`), 120);
    if (n) tenantNames.push(n);
  }
  const landlordName = cleanText(get("landlord_name"), 120);
  const details = detailsFromForm(get);
  if (!details.landlordLegalName && landlordName) details.landlordLegalName = landlordName;

  const startDate = isoOrNull(get("start_date"));
  const fixed = get("term") === "fixed";
  const endDate = fixed ? isoOrNull(get("end_date")) : null;

  const input: StandardLeaseInput = {
    landlordName: landlordName || details.landlordLegalName || "",
    tenantNames,
    propertyAddress: cleanText(get("address"), 240) || null,
    startDate,
    endDate,
    termMonths: null,
    rentCents: parseMoneyCents(get("rent")),
    depositCents: parseMoneyCents(get("deposit")),
    hasAdditionalTerms: cleanText(get("additional_terms"), MAX_TERMS).length > 0,
    details,
  };
  const additionalTerms = cleanText(get("additional_terms"), MAX_TERMS) || null;

  const missing = standardLeaseMissing(input);
  if (!input.landlordName) missing.unshift("the landlord's name");
  const problems = standardLeaseProblems(input);
  if (fixed && !endDate) problems.push("A fixed term needs an end date (Section 4).");
  if (startDate && endDate && endDate <= startDate) problems.push("The end date must be after the start date (Section 4).");

  return { input, additionalTerms, missing, problems };
}

/** A plain-text page for a refused download, so the landlord sees what to fix. */
export function problemsPage(problems: string[]): string {
  const items = problems.map((p) => `<li>${escape(p)}</li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Fix these before the lease prints</title><style>body{font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;color:#15211d;line-height:1.5}h1{font-size:1.3rem}a{color:#16756a}</style></head><body><h1>Fix these before the lease prints</h1><ul>${items}</ul><p>Go back, change the answer, and press the button again.</p></body></html>`;
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

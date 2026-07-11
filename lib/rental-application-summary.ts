// Pure builder + print renderer for the rental-application SUMMARY (S456, Slice
// 1b). The operator files a SUBMITTED application's NON-SENSITIVE summary into
// the document vault (0076): this renders the Form-410-equivalent record as a
// print-optimized standalone HTML document the operator opens and Prints ->
// Saves as PDF, then files. Mirrors lib/rent-receipt + lib/n1-render exactly —
// NO server PDF renderer (Chromium / heavy lib) is introduced.
//
// MODEL B (never-persist-tenant-PII): this renders ONLY the non-sensitive fields
// already stored on rental_applications.form_data (the lib/rental-application
// ALLOWED_FORM_FIELDS). SIN / DOB / driver's licence / uploaded ID+income docs
// are never captured or stored, so they can never appear here; the builder also
// hard-drops any SENSITIVE_BLOCKED_FIELDS key defensively (belt-and-braces).
//
// PURE + HTML-escaped + no I/O, so it is unit-tested
// (scripts/test-rental-application-summary.ts) and safe to render server-side.

import { escapeHtml } from "./n1-render";
import { SENSITIVE_BLOCKED_FIELDS } from "./rental-application";

const BLOCKED = new Set<string>(SENSITIVE_BLOCKED_FIELDS as readonly string[]);

// Human labels for the non-sensitive keys (mirror lib/rental-application
// ALLOWED_FORM_FIELDS + the lead-detail FORM_LABELS map).
export const APPLICATION_FIELD_LABELS: Record<string, string> = {
  current_address: "Current address",
  current_duration: "Time at current address",
  current_rent: "Current monthly rent",
  current_landlord_name: "Current landlord",
  current_landlord_contact: "Current landlord contact",
  current_reason_leaving: "Reason for leaving",
  previous_address: "Previous address",
  previous_duration: "Time at previous address",
  previous_landlord_name: "Previous landlord",
  previous_landlord_contact: "Previous landlord contact",
  employer: "Employer",
  position: "Position",
  employment_length: "Length of employment",
  supervisor_contact: "Supervisor / HR contact",
  gross_income: "Gross monthly income",
  second_employer: "Second employer",
  second_income: "Second income",
  other_income: "Other income",
  bank_reference_institution: "Bank / institution",
  reference_1_name: "Reference 1",
  reference_1_contact: "Reference 1 contact",
  reference_2_name: "Reference 2",
  reference_2_contact: "Reference 2 contact",
  vehicles: "Vehicle(s)",
  occupants: "Other occupants",
  smoking: "Smoking",
  pets: "Pets",
  emergency_contact_name: "Emergency contact",
  emergency_contact_phone: "Emergency contact phone",
};

// Section grouping (ordered). Any allowed key not listed here still renders under
// "Other details" so nothing silently vanishes.
const SECTIONS: { title: string; keys: string[] }[] = [
  {
    title: "Residence history",
    keys: [
      "current_address",
      "current_duration",
      "current_rent",
      "current_landlord_name",
      "current_landlord_contact",
      "current_reason_leaving",
      "previous_address",
      "previous_duration",
      "previous_landlord_name",
      "previous_landlord_contact",
    ],
  },
  {
    title: "Employment & income",
    keys: [
      "employer",
      "position",
      "employment_length",
      "supervisor_contact",
      "gross_income",
      "second_employer",
      "second_income",
      "other_income",
      "bank_reference_institution",
    ],
  },
  {
    title: "References",
    keys: ["reference_1_name", "reference_1_contact", "reference_2_name", "reference_2_contact"],
  },
  {
    title: "Household",
    keys: ["vehicles", "occupants", "smoking", "pets", "emergency_contact_name", "emergency_contact_phone"],
  },
];

export type ApplicationSummaryField = { key: string; label: string; value: string };
export type ApplicationSummarySection = { title: string; fields: ApplicationSummaryField[] };

export type ApplicationSummaryModel = {
  orgName: string;
  brandColor: string | null;
  logoUrl: string | null;
  orgContact: string | null;
  applicantName: string | null;
  applicantEmail: string | null;
  applicantPhone: string | null;
  propertyAddress: string | null;
  payMode: "applicant" | "landlord";
  submittedAtIso: string | null;
  generatedAtIso: string;
  sections: ApplicationSummarySection[];
};

/** Flatten a stored form value to a printable string; drops nested objects to a
 * compact "k: v" form and joins arrays. Never throws. */
export function stringifyFormValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) {
    return v
      .map((x) => stringifyFormValue(x))
      .filter((s) => s.length > 0)
      .join("; ");
  }
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => {
        const s = stringifyFormValue(val);
        return s ? `${k}: ${s}` : "";
      })
      .filter((s) => s.length > 0)
      .join(", ");
  }
  return String(v).trim();
}

/** A friendly label for a form key (falls back to a title-cased key). */
export function fieldLabel(key: string): string {
  return APPLICATION_FIELD_LABELS[key] ?? key.replace(/_/g, " ");
}

/** Build the grouped, non-sensitive summary sections from a form_data object.
 * Blocked keys are dropped defensively; empty values and empty sections are
 * omitted. Case-insensitive on key names (mirrors sanitizeFormData). */
export function buildSummarySections(
  formData: Record<string, unknown> | null | undefined,
): ApplicationSummarySection[] {
  const norm = new Map<string, string>();
  if (formData && typeof formData === "object" && !Array.isArray(formData)) {
    for (const [rawKey, rawVal] of Object.entries(formData)) {
      const k = rawKey.trim().toLowerCase();
      if (BLOCKED.has(k)) continue;
      const val = stringifyFormValue(rawVal);
      if (val.length > 0) norm.set(k, val);
    }
  }

  const used = new Set<string>();
  const sections: ApplicationSummarySection[] = [];
  for (const sec of SECTIONS) {
    const fields: ApplicationSummaryField[] = [];
    for (const key of sec.keys) {
      const value = norm.get(key);
      if (value) {
        fields.push({ key, label: fieldLabel(key), value });
        used.add(key);
      }
    }
    if (fields.length > 0) sections.push({ title: sec.title, fields });
  }

  // Any non-sensitive key not placed in a section still shows, so data never
  // silently disappears.
  const leftover: ApplicationSummaryField[] = [];
  for (const [key, value] of norm) {
    if (!used.has(key)) leftover.push({ key, label: fieldLabel(key), value });
  }
  if (leftover.length > 0) sections.push({ title: "Other details", fields: leftover });

  return sections;
}

export function buildApplicationSummaryModel(input: {
  orgName: string;
  brandColor?: string | null;
  logoUrl?: string | null;
  orgContact?: string | null;
  applicantName?: string | null;
  applicantEmail?: string | null;
  applicantPhone?: string | null;
  propertyAddress?: string | null;
  payMode?: string | null;
  submittedAtIso?: string | null;
  formData?: Record<string, unknown> | null;
  generatedAtIso: string;
}): ApplicationSummaryModel {
  return {
    orgName: input.orgName,
    brandColor: input.brandColor ?? null,
    logoUrl: input.logoUrl ?? null,
    orgContact: input.orgContact ?? null,
    applicantName: (input.applicantName ?? "").trim() || null,
    applicantEmail: (input.applicantEmail ?? "").trim() || null,
    applicantPhone: (input.applicantPhone ?? "").trim() || null,
    propertyAddress: (input.propertyAddress ?? "").trim() || null,
    payMode: input.payMode === "landlord" ? "landlord" : "applicant",
    submittedAtIso: input.submittedAtIso ?? null,
    generatedAtIso: input.generatedAtIso,
    sections: buildSummarySections(input.formData),
  };
}

/** Vault title for a filed application summary. */
export function applicationSummaryTitle(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  return n ? `Rental application — ${n}` : "Rental application";
}

// --- rendering helpers ------------------------------------------------------

/** Accept only a simple #hex color; otherwise the fallback. */
function safeColor(raw: string | null | undefined, fallback: string): string {
  const s = (raw ?? "").trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : fallback;
}

/** Accept only http(s) image URLs (defensive against javascript:/data: etc). */
function safeImageUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  return /^https?:\/\//i.test(s) ? s : null;
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Render the print-optimized standalone HTML summary. */
export function renderApplicationSummaryHtml(model: ApplicationSummaryModel): string {
  const accent = safeColor(model.brandColor, "#1a1a1a");
  const logoUrl = safeImageUrl(model.logoUrl);
  const submitted = fmtDate(model.submittedAtIso);
  const generated = fmtDate(model.generatedAtIso) ?? escapeHtml(model.generatedAtIso);

  const masthead = `<div class="masthead">
    ${logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(model.orgName)} logo" />` : ""}
    <div class="brand">
      <div class="org-name">${escapeHtml(model.orgName)}</div>
      ${model.orgContact ? `<div class="org-contact">${escapeHtml(model.orgContact)}</div>` : ""}
    </div>
  </div>`;

  const applicantRows: string[] = [];
  const addRow = (label: string, value: string | null) => {
    if (value && value.trim()) {
      applicantRows.push(`<tr><th>${escapeHtml(label)}</th><td class="val">${escapeHtml(value)}</td></tr>`);
    }
  };
  addRow("Applicant", model.applicantName);
  addRow("Email", model.applicantEmail);
  addRow("Phone", model.applicantPhone);
  addRow("Rental unit", model.propertyAddress);
  addRow("Screening paid by", model.payMode === "landlord" ? "Landlord" : "Applicant");
  addRow("Submitted", submitted);

  const sectionsHtml =
    model.sections.length > 0
      ? model.sections
          .map(
            (sec) => `<section>
    <h2>${escapeHtml(sec.title)}</h2>
    <table class="terms">
      ${sec.fields
        .map(
          (f) =>
            `<tr><th>${escapeHtml(f.label)}</th><td class="val">${escapeHtml(f.value)}</td></tr>`,
        )
        .join("\n      ")}
    </table>
  </section>`,
          )
          .join("\n  ")
      : `<div class="banner">The applicant acknowledged consent without completing the optional fields.</div>`;

  const titleAddr = model.propertyAddress ? " — " + escapeHtml(model.propertyAddress) : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Rental application${model.applicantName ? " — " + escapeHtml(model.applicantName) : ""}${titleAddr}</title>
<style>
  :root { --ink: #1a1a1a; --muted: #555; --line: #cfcfcf; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: var(--ink);
    line-height: 1.5; margin: 0; background: #f4f4f5; }
  .sheet { max-width: 7.5in; margin: 24px auto; background: #fff; padding: 0.9in 0.85in;
    box-shadow: 0 1px 6px rgba(0,0,0,0.12); border-top: 6px solid ${accent}; }
  .masthead { display: flex; align-items: center; gap: 16px; padding-bottom: 14px;
    margin-bottom: 18px; border-bottom: 1px solid var(--line); }
  .masthead .logo { max-height: 56px; max-width: 200px; object-fit: contain; }
  .masthead .org-name { font-size: 17px; font-weight: bold; color: var(--ink); }
  .masthead .org-contact { font-family: Arial, sans-serif; font-size: 12px; color: var(--muted); margin-top: 2px; }
  .eyebrow { font-family: Arial, sans-serif; font-size: 12px; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--muted); margin: 0 0 2px; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  .sub { color: var(--muted); font-size: 13px; margin: 0 0 18px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid var(--line); padding-bottom: 4px; margin: 22px 0 10px; }
  table.terms { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.terms th { text-align: left; width: 38%; vertical-align: top; padding: 5px 8px 5px 0;
    color: var(--muted); font-weight: normal; }
  table.terms td { padding: 5px 0; vertical-align: top; }
  .val { font-weight: bold; }
  section { break-inside: avoid; }
  .banner { border-radius: 6px; padding: 8px 12px; font-family: Arial, sans-serif;
    font-size: 12px; margin: 14px 0; background: #f3f4f6; border: 1px solid var(--line); color: var(--muted); }
  .foot { margin-top: 28px; border-top: 1px solid var(--line); padding-top: 10px;
    font-family: Arial, sans-serif; font-size: 11px; color: var(--muted); }
  .print-btn { position: fixed; top: 14px; right: 14px; font-family: Arial, sans-serif;
    font-size: 13px; padding: 8px 14px; border: 1px solid var(--line); border-radius: 6px;
    background: #fff; cursor: pointer; }
  @media print {
    body { background: #fff; }
    .sheet { box-shadow: none; margin: 0; max-width: none; padding: 0; }
    .print-btn { display: none; }
  }
  @page { margin: 0.8in; }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
<div class="sheet">
  ${masthead}
  <p class="eyebrow">Rental application</p>
  <h1>Application summary</h1>
  <p class="sub">Form 410-equivalent record — non-sensitive fields only</p>
  <table class="terms">
    ${applicantRows.join("\n    ")}
  </table>
  ${sectionsHtml}
  <div class="foot">
    Generated ${generated}. This summary intentionally contains no Social Insurance Number,
    date of birth, driver&rsquo;s licence, or banking details &mdash; those are never collected or
    stored by Vacantless. Credit &amp; background screening is completed by the applicant on the
    provider&rsquo;s secure hosted form.
  </div>
</div>
</body>
</html>`;
}

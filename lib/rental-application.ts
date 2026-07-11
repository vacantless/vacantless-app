// ============================================================================
// lib/rental-application — pure domain model for the rental-application capture
// (Slice 1, S453). No I/O; unit-testable. See
// RENTAL-APPLICATION-SLICE1-BUILD-SPEC-2026-07-11.md.
//
// MODEL B (never-persist-tenant-PII): this module captures ONLY the
// Form-410-equivalent NON-SENSITIVE record. The regulated identifiers (SIN, DOB,
// driver's licence, uploaded income/ID docs) are NEVER stored by Vacantless —
// they go to the screening provider's hosted form in Slice 2. `sanitizeFormData`
// is the TS half of that guarantee; migration 0125's submit RPC strips the same
// keys in SQL so the guardrail holds even against a direct anon RPC call.
// ============================================================================

import { normalizeEmail } from "./persons";

// --- Status machine ---------------------------------------------------------

export type RentalApplicationStatus =
  | "requested" // link minted, awaiting the applicant
  | "submitted" // applicant filled the non-sensitive form + acknowledged consent
  | "screening" // handed to the screening provider (Slice 2)
  | "complete" // report back, decision recordable (Slice 2/3)
  | "declined"; // withdrawn/declined (terminal)

export const RENTAL_APPLICATION_STATUSES: RentalApplicationStatus[] = [
  "requested",
  "submitted",
  "screening",
  "complete",
  "declined",
];

// Allowed forward transitions. Slice 1 exercises only requested -> submitted and
// the requested -> declined withdraw; the screening/complete edges are wired in
// Slice 2. A status may also stay itself (no-op) — callers guard that separately.
const ALLOWED_TRANSITIONS: Record<RentalApplicationStatus, RentalApplicationStatus[]> = {
  requested: ["submitted", "declined"],
  submitted: ["screening", "declined"],
  screening: ["complete", "declined"],
  complete: [],
  declined: [],
};

/** True when `to` is a legal next status from `from`. */
export function canTransition(
  from: RentalApplicationStatus,
  to: RentalApplicationStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Terminal statuses carry no outgoing transitions. */
export function isTerminalStatus(status: RentalApplicationStatus): boolean {
  return ALLOWED_TRANSITIONS[status]?.length === 0;
}

// --- Pay mode ---------------------------------------------------------------

export type PayMode = "applicant" | "landlord";

/** Normalize a raw pay-mode value, defaulting to applicant-paid. */
export function normalizePayMode(raw: string | null | undefined): PayMode {
  return raw === "landlord" ? "landlord" : "applicant";
}

// --- Form-data allow/deny ---------------------------------------------------

// The NON-SENSITIVE Form-410-equivalent fields Slice 1 stores. Everything the
// applicant fills lives under one of these top-level keys; anything else is
// dropped. `occupants` is an array; the rest are scalar strings on the wire.
export const ALLOWED_FORM_FIELDS = [
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
  "employer",
  "position",
  "employment_length",
  "supervisor_contact",
  "gross_income",
  "second_employer",
  "second_income",
  "other_income",
  "bank_reference_institution",
  "reference_1_name",
  "reference_1_contact",
  "reference_2_name",
  "reference_2_contact",
  "vehicles",
  "occupants",
  "smoking",
  "pets",
  "emergency_contact_name",
  "emergency_contact_phone",
] as const;

// Regulated / sensitive identifiers that must NEVER be persisted by Vacantless
// (Model B). Kept as an explicit denylist so the strip is auditable and mirrors
// the SQL strip in migration 0125.
export const SENSITIVE_BLOCKED_FIELDS = [
  "sin",
  "social_insurance_number",
  "dob",
  "date_of_birth",
  "driver_licence",
  "drivers_license",
  "driver_license",
  "income_documents",
  "income_docs",
  "id_document",
] as const;

const ALLOWED_SET = new Set<string>(ALLOWED_FORM_FIELDS);
const BLOCKED_SET = new Set<string>(SENSITIVE_BLOCKED_FIELDS);

export type SanitizedFormData = {
  /** The kept, non-sensitive subset. */
  data: Record<string, unknown>;
  /** Sensitive keys the caller tried to send (empty in the normal path). */
  droppedSensitive: string[];
  /** Unknown (non-allowed, non-sensitive) keys that were dropped. */
  droppedUnknown: string[];
};

/**
 * Keep only the allowed non-sensitive fields; drop everything else. Sensitive
 * keys are reported separately so the caller can alert on an attempted PII
 * submission (defense-in-depth for the never-persist rule). Case-insensitive on
 * key names.
 */
export function sanitizeFormData(raw: unknown): SanitizedFormData {
  const out: SanitizedFormData = { data: {}, droppedSensitive: [], droppedUnknown: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = key.trim().toLowerCase();
    if (BLOCKED_SET.has(k)) {
      out.droppedSensitive.push(k);
      continue;
    }
    if (ALLOWED_SET.has(k)) {
      out.data[k] = value;
      continue;
    }
    out.droppedUnknown.push(key);
  }
  return out;
}

// --- Submission validation --------------------------------------------------

export type SubmissionInput = {
  consent: boolean;
  applicant_name?: string | null;
  applicant_email?: string | null;
  applicant_phone?: string | null;
};

export type SubmissionValidation = {
  ok: boolean;
  errors: string[];
};

/**
 * Gate the applicant's submit: consent is mandatory (the credit pull cannot be
 * authorized without it), a name is required, and at least one contact channel
 * (email or phone) must be present so the operator can reach them.
 */
export function validateSubmission(input: SubmissionInput): SubmissionValidation {
  const errors: string[] = [];
  if (input.consent !== true) errors.push("consent_required");
  if (!(input.applicant_name ?? "").trim()) errors.push("name_required");
  const hasEmail = !!(input.applicant_email ?? "").trim();
  const hasPhone = !!(input.applicant_phone ?? "").trim();
  if (!hasEmail && !hasPhone) errors.push("contact_required");
  return { ok: errors.length === 0, errors };
}

// --- Person candidate (reuse the persons identity rule) ---------------------

/**
 * Build the person-resolution candidate from an application's applicant basics,
 * reusing lib/persons' email-norm rule. Phone is expected already E.164-normalized
 * upstream (lib/sms), mirroring how tenants/leads keys are built.
 */
export function applicationPersonCandidate(input: {
  applicant_email?: string | null;
  applicant_phone_e164?: string | null;
}): { email_norm: string | null; phone_e164: string | null } {
  return {
    email_norm: normalizeEmail(input.applicant_email),
    phone_e164: (input.applicant_phone_e164 ?? "").trim() || null,
  };
}

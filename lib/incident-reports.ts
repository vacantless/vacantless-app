// Pure, dependency-free domain logic for tenant incident reports
// (Option B incident-dispatch, Slice 2 — tenant tokenized intake).
//
// Everything here is deterministic and unit-tested
// (scripts/test-incident-reports.ts) so the tokenized tenant write path (the
// /report/[token] page + its server actions) and the SECURITY DEFINER SQL RPCs
// agree on ONE source of truth for: the category whitelist, the submission
// rules (mirrored verbatim in the submit RPC — the anon-RPC re-validate rule
// means both must agree), the report state machine (used by the Slice-3
// operator triage), and the per-tenancy report token.
//
// Mirrors lib/lease-signing.ts (the other tokenized account-less surface): the
// only crypto use is the unguessable token; the rest is pure string/array work.
// No Supabase / Next imports.

import { randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// Category whitelist — IDENTICAL to work_orders.category (migration 0054) so an
// approved report converts straight into a work order with no remap. Kept here
// (not imported from lib/work-orders) so this module stays free of any heavier
// dependency; a test asserts the two lists match.
// ---------------------------------------------------------------------------
export const INCIDENT_CATEGORIES = [
  "plumbing",
  "electrical",
  "hvac",
  "appliance",
  "structural",
  "pest",
  "landscaping",
  "cleaning",
  "general",
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export function isIncidentCategory(value: unknown): value is IncidentCategory {
  return (
    typeof value === "string" &&
    (INCIDENT_CATEGORIES as readonly string[]).includes(value)
  );
}

// Tenant-facing labels for the category picker. Plain language a renter
// recognizes (not the operator's taxonomy verbatim).
export const INCIDENT_CATEGORY_LABELS: Record<IncidentCategory, string> = {
  plumbing: "Plumbing / water",
  electrical: "Electrical",
  hvac: "Heating / cooling",
  appliance: "Appliance",
  structural: "Structural / building",
  pest: "Pests",
  landscaping: "Outdoor / landscaping",
  cleaning: "Cleaning",
  general: "Something else",
};

export function incidentCategoryLabel(category: string): string {
  return isIncidentCategory(category)
    ? INCIDENT_CATEGORY_LABELS[category]
    : category;
}

// ---------------------------------------------------------------------------
// Report lifecycle. Unapproved tenant noise lives in incident_reports and never
// touches the operator's work_orders queue until approved+converted.
//   submitted     — tenant just sent it; in the operator triage inbox
//   under_review  — operator has opened/triaged it (optional intermediate)
//   approved      — operator accepted it; about to/just promoted to a work order
//   converted     — a work_orders row now exists (converted_work_order_id set)
//   declined      — operator rejected it (decline_reason set); terminal
// ---------------------------------------------------------------------------
export const INCIDENT_REPORT_STATUSES = [
  "submitted",
  "under_review",
  "approved",
  "converted",
  "declined",
] as const;
export type IncidentReportStatus = (typeof INCIDENT_REPORT_STATUSES)[number];

export function isIncidentReportStatus(
  value: unknown,
): value is IncidentReportStatus {
  return (
    typeof value === "string" &&
    (INCIDENT_REPORT_STATUSES as readonly string[]).includes(value)
  );
}

export function incidentReportStatusLabel(status: string): string {
  switch (status) {
    case "submitted":
      return "New";
    case "under_review":
      return "Under review";
    case "approved":
      return "Approved";
    case "converted":
      return "Converted to work order";
    case "declined":
      return "Declined";
    default:
      return status;
  }
}

// A report is "open" (still actionable in the operator triage inbox) while it
// has neither converted nor been declined.
export function isOpenReportStatus(status: string): boolean {
  return status === "submitted" || status === "under_review";
}

// Operator may approve/decline only an open report (submitted | under_review).
// Mirrored in the Slice-3 RPC. Defined now so the state machine ships fully
// tested with the table.
export function canApproveReport(status: string): boolean {
  return isOpenReportStatus(status);
}

export function canDeclineReport(status: string): boolean {
  return isOpenReportStatus(status);
}

// A token may still receive NEW media for a report only while it is open — once
// converted/declined the tenant intake is closed. The submit RPC + record-media
// RPC both enforce this server-side.
export function reportAcceptsMedia(status: string): boolean {
  return isOpenReportStatus(status);
}

// ---------------------------------------------------------------------------
// Per-tenancy report token — the tenant's only handle (no account), same shape
// as lib/lease-signing.generateSignToken. base64url of 24 random bytes = 32
// url-safe chars, ~192 bits. Unlike a lease signer token (single document), a
// tenancy's report token is STABLE and reusable: the tenant can report many
// incidents over the life of the tenancy from one bookmarked link.
// ---------------------------------------------------------------------------
export function generateReportToken(): string {
  return randomBytes(24).toString("base64url");
}

// ---------------------------------------------------------------------------
// Submission validation — shared with the submit_incident_report SQL RPC. The
// RPC re-checks each of these (the anon-RPC re-validate rule), so the reason
// strings are kept identical on both sides.
// ---------------------------------------------------------------------------

// A description is required (there must be something to act on) and capped so a
// single payload can't be abused. reporter_name/contact are optional (prefilled
// from the tenancy where known); category must be in the whitelist.
export const MAX_DESCRIPTION_LEN = 4000;
export const MIN_DESCRIPTION_LEN = 3;

export type ReportSubmission = {
  category?: string | null;
  description?: string | null;
};

export type ReportValidation =
  | { ok: true; category: IncidentCategory; description: string }
  | { ok: false; reason: "bad_category" | "description_required" | "description_too_long" };

export function validateReportSubmission(s: ReportSubmission): ReportValidation {
  if (!isIncidentCategory(s.category)) {
    return { ok: false, reason: "bad_category" };
  }
  const description = (s.description ?? "").trim();
  if (description.length < MIN_DESCRIPTION_LEN) {
    return { ok: false, reason: "description_required" };
  }
  if (description.length > MAX_DESCRIPTION_LEN) {
    return { ok: false, reason: "description_too_long" };
  }
  return { ok: true, category: s.category, description };
}

// Plain-language copy for each failure reason (page error banner). Also covers
// the token/closed reasons the server actions can surface.
export function reportErrorMessage(reason: string | undefined): string {
  switch (reason) {
    case "bad_category":
      return "Please choose what the issue is about.";
    case "description_required":
      return "Please describe the issue so we can help.";
    case "description_too_long":
      return "That description is too long — please shorten it.";
    case "not_found":
      return "We couldn't find this reporting link. Please contact your property manager.";
    case "closed":
      return "This report is already being handled and can't take new uploads.";
    case "media_failed":
      return "We couldn't attach one of your files. Please try again.";
    case "failed":
    default:
      return "Something went wrong. Please try again.";
  }
}

// ---------------------------------------------------------------------------
// Reporter defaults — who to pre-fill the report's name/contact from. The
// primary tenant on the tenancy is the natural reporter; fall back to the first
// tenant with any usable identity. Pure — the page/RPC layer the snapshot on.
// ---------------------------------------------------------------------------
export type ReporterTenantLike = {
  name: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
};

export type ReporterDefaults = { name: string | null; contact: string | null };

export function deriveReporterDefaults(
  tenants: ReporterTenantLike[],
): ReporterDefaults {
  if (!tenants || tenants.length === 0) return { name: null, contact: null };
  const ordered = tenants
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const pick =
    ordered.find(
      (t) => (t.name && t.name.trim()) || (t.email && t.email.trim()) || (t.phone && t.phone.trim()),
    ) ?? ordered[0];
  const name = pick.name && pick.name.trim() ? pick.name.trim() : null;
  const contact =
    pick.email && pick.email.trim()
      ? pick.email.trim()
      : pick.phone && pick.phone.trim()
        ? pick.phone.trim()
        : null;
  return { name, contact };
}

// ---------------------------------------------------------------------------
// Tenant report link — the URL an operator copies for a tenancy. Pure string
// build so the page + the operator "copy link" action agree.
// ---------------------------------------------------------------------------
export function tenantReportPath(token: string): string {
  return `/report/${encodeURIComponent(token)}`;
}

export function tenantReportUrl(baseUrl: string, token: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}${tenantReportPath(token)}`;
}

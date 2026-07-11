// ============================================================================
// lib/rental-screening — the provider-agnostic screening seam (Slice 2, S455).
//
// Mirrors lib/bank-feed/index.ts: a Canadian tenant-screening provider
// (SingleKey today; Certn later) is a swappable adapter behind ONE
// `ScreeningProvider` interface, and everything downstream (the lead-detail
// result card, the decision copy, the application status machine) only ever
// sees a `NormalizedScreeningReport` and never knows which vendor produced it.
//
// This file holds the CONTRACT + the pure routing / normalization helpers with
// NO vendor or network dependency, so they are unit-testable in isolation
// (scripts/test-rental-screening.ts). The concrete adapter lives in ./singlekey.ts.
//
// DARK: the whole seam ships behind (1) the `applications` plan entitlement
// (canScreen) and (2) an env-provisioned provider token (singleKeyConfigured in
// ./singlekey.ts). With no SINGLEKEY_API_TOKEN in env it never fires — so this
// can land in prod inert until Noam provisions the sandbox token in Vercel.
// See RENTAL-APPLICATION-SLICE1-BUILD-SPEC-2026-07-11.md (§Slice 2 seam) and
// RENTAL-APPLICATION-CREDIT-SCREENING-DESIGN-2026-07-10.md (Model B).
//
// MODEL B (never-persist-tenant-PII): the applicant enters SIN/DOB/ID + gives
// credit consent ON THE PROVIDER'S hosted form (tenant_form_url). Vacantless
// stores only the report status + reference + score band — NEVER the regulated
// identifiers. Nothing in this module accepts or returns a SIN/DOB/DL.
// ============================================================================

import type { PlanEntitlements } from "../billing";
import type { PayMode, RentalApplicationStatus } from "../rental-application";
import { canTransition } from "../rental-application";

// --- Keys / normalized shapes (the only things downstream code sees) --------

export type ScreeningProviderKey = "singlekey"; // | "certn" (fallback, later)

/** Who pays the report fee at invite time. Maps 1:1 from rental_applications.pay_mode. */
export type ScreeningPayer = "applicant" | "landlord";

/** Provider-normalized report lifecycle, independent of any vendor's raw strings. */
export type ScreeningReportStatus =
  | "pending" // invite sent; applicant has not finished the hosted form
  | "in_progress" // applicant submitted; report generating
  | "complete" // report ready
  | "cancelled" // invite/report cancelled or expired (terminal)
  | "error"; // provider error (no state change; surface + retry)

/** Our coarse recommendation band, derived from the provider's score/recommendation. */
export type ScreeningRecommendation = "approve" | "review" | "decline" | "unknown";

/**
 * The normalized request our code builds to open a screening invite. NON-SENSITIVE
 * only — the provider collects SIN/DOB/ID on its side. `externalCustomerId` /
 * `externalTenantId` are our org/person ids echoed back on the webhook so we can
 * re-anchor the result without storing any provider-side PII.
 */
export type ScreeningInviteRequest = {
  externalCustomerId: string; // org id -> SingleKey external_customer_id
  externalTenantId: string; // person id -> SingleKey external_tenant_id
  applicantName: string;
  applicantEmail: string | null;
  applicantPhone: string | null; // E.164
  payer: ScreeningPayer;
};

/** What a provider returns to hand the applicant off to its hosted form. */
export type ScreeningInviteHandoff = {
  provider: ScreeningProviderKey;
  purchaseToken: string; // durable report handle (SingleKey purchase_token)
  tenantFormUrl: string; // the hosted applicant link (tenant_form_url)
  expiresAt: string | null;
};

/** The only screening result shape downstream code ever sees. Carries NO PII. */
export type NormalizedScreeningReport = {
  provider: ScreeningProviderKey;
  purchaseToken: string;
  status: ScreeningReportStatus;
  recommendation: ScreeningRecommendation;
  scoreBand: string | null; // provider's band label, display-only
  reportUrl: string | null; // link to the hosted report (no PII inline)
  completedAt: string | null; // ISO, set when status === "complete"
};

// --- The contract every screening adapter implements ------------------------

export interface ScreeningProvider {
  readonly key: ScreeningProviderKey;
  /** Open a hosted screening invite; returns the applicant handoff + report handle. */
  createInvite(req: ScreeningInviteRequest): Promise<ScreeningInviteHandoff>;
  /** Poll the current report state for a purchase token (webhook is the primary path). */
  fetchReport(purchaseToken: string): Promise<NormalizedScreeningReport>;
}

// --- Provider routing (pure) ------------------------------------------------
//
// Screening gates on the SAME `applications` entitlement as Slice-1 capture
// (Growth+, per S453) — screening is the climax of the leasing funnel Growth
// already owns, and the report is applicant-paid = near-zero COGS. Free / unentitled
// orgs capture nothing and screen nothing.

/** True when the org's plan may run credit/background screening at all. */
export function canScreen(entitlements: PlanEntitlements): boolean {
  return entitlements.applications === true;
}

/** The provider to use for a NEW screening invite, or null when not entitled. */
export function providerForPlan(entitlements: PlanEntitlements): ScreeningProviderKey | null {
  return canScreen(entitlements) ? "singlekey" : null;
}

// --- pay mode -> payer (pure seam) ------------------------------------------

/** Map the application's who-pays choice to the provider payer param. */
export function payerForMode(payMode: PayMode): ScreeningPayer {
  return payMode === "landlord" ? "landlord" : "applicant";
}

// --- Build the invite request from an application row (pure) -----------------

export type BuildInviteResult =
  | { ok: true; request: ScreeningInviteRequest }
  | { ok: false; errors: string[] };

/**
 * Assemble + validate the normalized invite request from a submitted
 * rental_applications row. A person is resolved when the application is
 * requested (requestRentalApplication -> resolvePersonId), so person_id is set
 * before screening; a name and at least one contact channel are required so the
 * provider can reach the applicant. Pure — no I/O, no PII.
 */
export function buildInviteRequest(input: {
  orgId: string | null | undefined;
  personId: string | null | undefined;
  applicantName: string | null | undefined;
  applicantEmail: string | null | undefined;
  applicantPhoneE164: string | null | undefined;
  payMode: PayMode;
}): BuildInviteResult {
  const errors: string[] = [];
  const orgId = (input.orgId ?? "").trim();
  const personId = (input.personId ?? "").trim();
  const name = (input.applicantName ?? "").trim();
  const email = (input.applicantEmail ?? "").trim() || null;
  const phone = (input.applicantPhoneE164 ?? "").trim() || null;
  if (!orgId) errors.push("org_required");
  if (!personId) errors.push("person_required");
  if (!name) errors.push("name_required");
  if (!email && !phone) errors.push("contact_required");
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    request: {
      externalCustomerId: orgId,
      externalTenantId: personId,
      applicantName: name,
      applicantEmail: email,
      applicantPhone: phone,
      payer: payerForMode(input.payMode),
    },
  };
}

// --- Normalizers (pure) -----------------------------------------------------

/**
 * Coerce a provider's raw status string into our lifecycle. Tolerant of the vendor
 * synonyms we expect (the exact SingleKey enum is behind the token — this is
 * provisional and centralizes the mapping so wiring it exactly is a one-file edit).
 * Unknown / empty -> "pending" (safe: keeps the application in `screening`).
 */
export function coerceReportStatus(raw: string | null | undefined): ScreeningReportStatus {
  const v = (raw ?? "").trim().toLowerCase();
  if (["complete", "completed", "ready", "done", "report_complete"].includes(v)) return "complete";
  if (["in_progress", "in-progress", "processing", "pending_report", "generating", "submitted"].includes(v))
    return "in_progress";
  if (["cancelled", "canceled", "expired", "withdrawn", "declined_by_applicant"].includes(v))
    return "cancelled";
  if (["error", "failed", "failure"].includes(v)) return "error";
  return "pending"; // invited / awaiting_applicant / unknown
}

/**
 * Map the provider's recommendation/decision string to our coarse band.
 * Unknown / empty -> "unknown" (never auto-approve on ambiguity).
 */
export function normalizeRecommendation(raw: string | null | undefined): ScreeningRecommendation {
  const v = (raw ?? "").trim().toLowerCase();
  if (["approve", "approved", "accept", "accepted", "pass", "recommended", "low_risk", "low risk"].includes(v))
    return "approve";
  if (["review", "conditional", "caution", "medium_risk", "medium risk", "manual_review", "further_review"].includes(v))
    return "review";
  if (["decline", "declined", "reject", "rejected", "fail", "high_risk", "high risk"].includes(v))
    return "decline";
  return "unknown";
}

/**
 * The rental-application status a given report state implies:
 *   pending / in_progress -> "screening" (in flight)
 *   complete              -> "complete"
 *   cancelled             -> "declined"
 *   error                 -> null (no state change; surface the error)
 */
export function applicationStatusForReport(
  reportStatus: ScreeningReportStatus,
): RentalApplicationStatus | null {
  switch (reportStatus) {
    case "pending":
    case "in_progress":
      return "screening";
    case "complete":
      return "complete";
    case "cancelled":
      return "declined";
    case "error":
      return null;
  }
}

/**
 * The next rental-application status to persist given the current one and a fresh
 * report state — or null when there is nothing legal to do (no-op, illegal edge,
 * or a provider error). Composes the report->status map with the Slice-1 status
 * machine (canTransition) so the screening path can never make an illegal jump
 * (e.g. a late webhook can't move a `complete` application back to `screening`).
 */
export function nextApplicationStatus(
  current: RentalApplicationStatus,
  reportStatus: ScreeningReportStatus,
): RentalApplicationStatus | null {
  const target = applicationStatusForReport(reportStatus);
  if (target === null) return null;
  if (target === current) return null; // already there — no-op
  return canTransition(current, target) ? target : null;
}

// --- Webhook (pure) ---------------------------------------------------------

/**
 * Constant-time-ish equality for the provider's Handshake-Token on inbound
 * "Report Complete" webhooks. Rejects when either side is empty or lengths differ.
 * (The actual token value is env-provisioned — never hard-coded here.)
 */
export function isValidHandshake(
  expected: string | null | undefined,
  provided: string | null | undefined,
): boolean {
  const e = (expected ?? "").trim();
  const p = (provided ?? "").trim();
  if (!e || !p || e.length !== p.length) return false;
  let diff = 0;
  for (let i = 0; i < e.length; i++) diff |= e.charCodeAt(i) ^ p.charCodeAt(i);
  return diff === 0;
}

/**
 * Parse a provider "Report Complete" webhook body into a NormalizedScreeningReport.
 * Defensive about key names across the shapes we might get (snake/camel), since the
 * exact SingleKey payload is behind the token — centralized so the final wiring is a
 * one-file edit. Returns null when there is no usable purchase token. Reads ONLY the
 * non-sensitive result fields; ignores anything PII-ish by never looking for it.
 */
export function parseReportCompleteWebhook(payload: unknown): NormalizedScreeningReport | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const str = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = p[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number") return String(v);
    }
    return null;
  };
  const purchaseToken = str("purchase_token", "purchaseToken", "report_id", "reportId", "id");
  if (!purchaseToken) return null;
  const status = coerceReportStatus(str("status", "report_status", "state"));
  return {
    provider: "singlekey",
    purchaseToken,
    status,
    recommendation: normalizeRecommendation(str("recommendation", "decision", "result", "risk_level")),
    scoreBand: str("score_band", "scoreBand", "band", "credit_band"),
    reportUrl: str("report_url", "reportUrl", "url", "report_link"),
    completedAt: status === "complete" ? str("completed_at", "completedAt", "finished_at") : null,
  };
}

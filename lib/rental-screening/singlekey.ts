// ============================================================================
// lib/rental-screening/singlekey — the SingleKey adapter (Slice 2, S455). DARK.
//
// Implements the ScreeningProvider contract against SingleKey's Screening API
// (https://github.com/singlekey-screening/Screening-Api). Token auth via
// `Authorization: Token <key>`; the hosted invite flow is
// `POST /screen/embedded_flow_request` -> `{ purchase_token, tenant_form_url }`;
// results arrive via the "Report Complete" webhook (primary) or polling (fallback).
//
// DARK BY CONSTRUCTION: `getSingleKeyProvider()` returns null unless
// SINGLEKEY_API_TOKEN is present in env. Noam sets that value in Vercel — this
// code NEVER contains or logs the token. Base URL defaults to the sandbox.
//
// The request/response FIELD NAMES below are provisional (the exact schema is
// behind the sandbox token). Every provider->normalized mapping is funnelled
// through the pure helpers in ./index.ts, so confirming the real shape against
// sandbox.singlekey.com once the token lands is a small, contained edit here.
// ============================================================================

import {
  type ScreeningProvider,
  type ScreeningInviteRequest,
  type ScreeningInviteHandoff,
  type NormalizedScreeningReport,
  coerceReportStatus,
  normalizeRecommendation,
} from "./index";

const DEFAULT_BASE = "https://sandbox.singlekey.com";

function apiBase(): string {
  return (process.env.SINGLEKEY_API_BASE || DEFAULT_BASE).replace(/\/+$/, "");
}

function apiToken(): string {
  return (process.env.SINGLEKEY_API_TOKEN || "").trim();
}

/** True only when a SingleKey token is provisioned in env (Vercel). */
export function singleKeyConfigured(): boolean {
  return apiToken().length > 0;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Token ${apiToken()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** Map a raw SingleKey report object to our normalized, PII-free shape. */
export function normalizeSingleKeyReport(raw: unknown): NormalizedScreeningReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const str = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = r[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number") return String(v);
    }
    return null;
  };
  const purchaseToken = str("purchase_token", "purchaseToken", "id");
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

class SingleKeyProvider implements ScreeningProvider {
  readonly key = "singlekey" as const;

  async createInvite(req: ScreeningInviteRequest): Promise<ScreeningInviteHandoff> {
    const res = await fetch(`${apiBase()}/screen/embedded_flow_request`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        tenant_form: true,
        external_customer_id: req.externalCustomerId,
        external_tenant_id: req.externalTenantId,
        pay_mode: req.payer, // "applicant" | "landlord" — chosen at invite time
        applicant: {
          name: req.applicantName,
          email: req.applicantEmail,
          phone: req.applicantPhone,
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`singlekey embedded_flow_request failed: ${res.status}`);
    }
    const j = (await res.json()) as Record<string, unknown>;
    const purchaseToken = typeof j.purchase_token === "string" ? j.purchase_token : "";
    const tenantFormUrl = typeof j.tenant_form_url === "string" ? j.tenant_form_url : "";
    if (!purchaseToken || !tenantFormUrl) {
      throw new Error("singlekey embedded_flow_request: missing purchase_token / tenant_form_url");
    }
    return {
      provider: "singlekey",
      purchaseToken,
      tenantFormUrl,
      expiresAt: typeof j.expires_at === "string" ? j.expires_at : null,
    };
  }

  async fetchReport(purchaseToken: string): Promise<NormalizedScreeningReport> {
    const res = await fetch(
      `${apiBase()}/screen/report/${encodeURIComponent(purchaseToken)}`,
      { method: "GET", headers: authHeaders() },
    );
    if (!res.ok) {
      throw new Error(`singlekey fetchReport failed: ${res.status}`);
    }
    const normalized = normalizeSingleKeyReport(await res.json());
    if (!normalized) {
      throw new Error("singlekey fetchReport: unparseable report body");
    }
    return normalized;
  }
}

/**
 * The live SingleKey provider, or null when no token is provisioned. Callers MUST
 * treat null as "screening not available yet" and fall back gracefully — this is
 * how the whole seam stays dark in prod until Noam sets SINGLEKEY_API_TOKEN in Vercel.
 */
export function getSingleKeyProvider(): ScreeningProvider | null {
  if (!singleKeyConfigured()) return null;
  return new SingleKeyProvider();
}

// Rotessa rent-collection client (platform pivot step 2, S210).
//
// MODEL (locked S210): the LANDLORD brings their own Rotessa account. Vacantless
// stores only their API token, encrypted at rest (lib/crypto.ts), and acts as a
// scheduling + visibility layer. We NEVER store bank/PAD/account numbers and
// never hold funds — the landlord's tenants authorize directly in Rotessa; we
// reference customers by `custom_identifier` and only READ status. So nothing in
// this module ever touches a bank account number.
//
// API (verified live against rotessa.com/docs, 2026-06-16):
//   * Auth header: `Authorization: Token token="<api_key>"`.
//   * Base URL: live  = https://api.rotessa.com/v1
//               sandbox = https://sandbox-api.rotessa.com/v1
//   * Connection test = GET /customers (200 = key valid; 401 = key rejected).
//   * Later increments: POST /customers (create from primary tenant) ->
//     POST /transaction_schedules (Monthly, amount = rent, omit installments for
//     indefinite) -> GET /transaction_report (nightly poll for Approved/Declined
//     + status_reason).
//
// This increment is CONNECTION ONLY: environment/URL helpers, key
// validation/masking, response classification (all pure + unit-tested in
// scripts/test-rotessa.ts) and a single impure testConnection() fetch.

export const ROTESSA_ENVIRONMENTS = ["sandbox", "live"] as const;
export type RotessaEnvironment = (typeof ROTESSA_ENVIRONMENTS)[number];

export const ROTESSA_CONNECTION_STATUSES = ["not_connected", "connected", "error"] as const;
export type RotessaConnectionStatus = (typeof ROTESSA_CONNECTION_STATUSES)[number];

const BASE_URLS: Record<RotessaEnvironment, string> = {
  sandbox: "https://sandbox-api.rotessa.com/v1",
  live: "https://api.rotessa.com/v1",
};

const ENVIRONMENT_LABELS: Record<RotessaEnvironment, string> = {
  sandbox: "Sandbox (test)",
  live: "Live",
};

export function isRotessaEnvironment(value: unknown): value is RotessaEnvironment {
  return typeof value === "string" && (ROTESSA_ENVIRONMENTS as readonly string[]).includes(value);
}

// Coerce an unknown/stored environment string. Unknown -> sandbox (the safe
// default: a misconfigured value never silently points at live / real money).
export function normalizeEnvironment(value: unknown): RotessaEnvironment {
  return isRotessaEnvironment(value) ? value : "sandbox";
}

export function rotessaBaseUrl(env: RotessaEnvironment): string {
  return BASE_URLS[normalizeEnvironment(env)];
}

export function environmentLabel(value: unknown): string {
  return ENVIRONMENT_LABELS[normalizeEnvironment(value)];
}

/** The exact Authorization header value Rotessa expects. */
export function rotessaAuthHeader(apiKey: string): string {
  return `Token token="${apiKey}"`;
}

export type ApiKeyValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Validate a pasted API key. Trims surrounding whitespace; rejects empty and
 * obviously-too-short values. We do NOT over-constrain the format (Rotessa
 * doesn't publish one) — the real check is the live connection test.
 */
export function validateApiKey(raw: string | null | undefined): ApiKeyValidation {
  const value = (raw ?? "").trim();
  if (!value) return { ok: false, error: "Enter your Rotessa API key." };
  if (value.length < 10) return { ok: false, error: "That API key looks too short." };
  if (/\s/.test(value)) return { ok: false, error: "An API key shouldn't contain spaces." };
  return { ok: true, value };
}

/**
 * Mask a key for display: show the last 4 characters, mask the rest. Never
 * render a stored key in full. A short/empty key masks entirely.
 */
export function maskApiKey(key: string | null | undefined): string {
  const s = (key ?? "").trim();
  if (!s) return "";
  if (s.length <= 4) return "••••";
  return `${"•".repeat(Math.min(s.length - 4, 12))}${s.slice(-4)}`;
}

/**
 * Map an HTTP status from a Rotessa call to a connection result + a
 * human-readable message. Pure so it can be unit-tested without a network call.
 */
export function classifyConnectionStatus(
  httpStatus: number,
): { ok: boolean; status: RotessaConnectionStatus; message: string } {
  if (httpStatus >= 200 && httpStatus < 300) {
    return { ok: true, status: "connected", message: "Connected to Rotessa." };
  }
  if (httpStatus === 401) {
    return { ok: false, status: "error", message: "Rotessa rejected the API key (401). Check the key and environment." };
  }
  if (httpStatus === 403) {
    return { ok: false, status: "error", message: "This API key is not authorized (403)." };
  }
  if (httpStatus === 404) {
    return { ok: false, status: "error", message: "Rotessa endpoint not found (404)." };
  }
  if (httpStatus >= 500) {
    return { ok: false, status: "error", message: `Rotessa is temporarily unavailable (${httpStatus}). Try again shortly.` };
  }
  return { ok: false, status: "error", message: `Unexpected response from Rotessa (${httpStatus}).` };
}

export type ConnectionTestResult = {
  ok: boolean;
  status: RotessaConnectionStatus;
  message: string;
  httpStatus?: number;
};

/**
 * Live connection test (the only impure function here). Calls GET /customers
 * with the supplied key + environment and classifies the response. A network /
 * fetch failure is reported as an error result rather than throwing, so the
 * caller (a server action) can always persist a clean status + message.
 *
 * 8s timeout so a hung Rotessa never wedges the settings action.
 */
export async function testConnection(
  apiKey: string,
  environment: RotessaEnvironment,
): Promise<ConnectionTestResult> {
  const url = `${rotessaBaseUrl(environment)}/customers`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: rotessaAuthHeader(apiKey),
        Accept: "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const classified = classifyConnectionStatus(res.status);
    return { ...classified, httpStatus: res.status };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      status: "error",
      message: aborted
        ? "Rotessa did not respond in time. Try again."
        : "Could not reach Rotessa. Check your connection and try again.",
    };
  } finally {
    clearTimeout(timer);
  }
}

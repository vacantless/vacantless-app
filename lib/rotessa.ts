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

// ===========================================================================
// Increment 2 — create a Rotessa customer from a tenancy's primary tenant.
//
// We POST /customers with ONLY name/email/phone + a stable custom_identifier
// (the tenancy id). NO bank/PAD/account fields are ever sent — the customer is
// a shell; the tenant authorizes their bank details directly in Rotessa. The
// returned numeric id is stored on the tenancy and becomes the reference for
// the later transaction_schedule + transaction_report calls.
//
// The request-body builder, input validation, and response parser are PURE
// (unit-tested in scripts/test-rotessa.ts); createCustomer() is the only
// impure fetch.
// ===========================================================================

export type RotessaCustomerInput = {
  name: string;
  email: string | null;
  phone: string | null;
  customIdentifier: string;
};

export type CustomerInputValidation =
  | { ok: true; value: RotessaCustomerInput }
  | { ok: false; error: string };

/**
 * Validate the data we'll send to Rotessa for a new customer. Rotessa requires
 * a name; custom_identifier must be unique (we use the tenancy id). Email/phone
 * are optional. Trims everything; drops blank optionals to null.
 */
export function validateCustomerInput(raw: {
  name: string | null | undefined;
  email: string | null | undefined;
  phone: string | null | undefined;
  customIdentifier: string | null | undefined;
}): CustomerInputValidation {
  const name = (raw.name ?? "").trim();
  const customIdentifier = (raw.customIdentifier ?? "").trim();
  if (!name) {
    return { ok: false, error: "The primary tenant needs a name before creating a Rotessa customer." };
  }
  if (!customIdentifier) {
    return { ok: false, error: "Missing a customer reference for this tenancy." };
  }
  const email = (raw.email ?? "").trim() || null;
  const phone = (raw.phone ?? "").trim() || null;
  return { ok: true, value: { name, email, phone, customIdentifier } };
}

/**
 * Build the JSON body for POST /customers. Always includes name +
 * custom_identifier; includes email/phone only when present (no empty strings
 * sent). Deliberately carries NO bank fields. Pure.
 */
export function buildCustomerBody(input: RotessaCustomerInput): Record<string, string> {
  const body: Record<string, string> = {
    name: input.name,
    custom_identifier: input.customIdentifier,
  };
  if (input.email) body.email = input.email;
  if (input.phone) body.phone = input.phone;
  return body;
}

export type CreateCustomerResult =
  | { ok: true; customerId: string; uuid: string | null; customIdentifier: string | null }
  | { ok: false; status: RotessaConnectionStatus; message: string; httpStatus?: number };

/** Pull human-readable messages out of a Rotessa `{ errors: [...] }` payload. */
export function extractRotessaErrors(json: unknown): string[] {
  if (!json || typeof json !== "object") return [];
  const errs = (json as { errors?: unknown }).errors;
  if (!Array.isArray(errs)) return [];
  return errs
    .map((e) =>
      e && typeof e === "object" && typeof (e as { error_message?: unknown }).error_message === "string"
        ? (e as { error_message: string }).error_message
        : null,
    )
    .filter((m): m is string => !!m);
}

/**
 * Classify a POST /customers response. Pure so it's fully unit-testable. A 2xx
 * with a usable numeric `id` is success; a 2xx WITHOUT an id is treated as an
 * error (defensive — we never want to record a customer we can't reference).
 * Non-2xx maps to a clear message, surfacing Rotessa's own error text (e.g. a
 * duplicate custom_identifier on 422) when present.
 */
export function parseCreateCustomerResponse(httpStatus: number, json: unknown): CreateCustomerResult {
  if (httpStatus >= 200 && httpStatus < 300) {
    const obj = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
    const rawId = obj.id;
    const id = typeof rawId === "number" ? String(rawId) : typeof rawId === "string" && rawId.trim() ? rawId.trim() : null;
    if (!id) {
      return { ok: false, status: "error", message: "Rotessa accepted the request but returned no customer id.", httpStatus };
    }
    const uuid = typeof obj.uuid === "string" ? obj.uuid : null;
    const customIdentifier = typeof obj.custom_identifier === "string" ? obj.custom_identifier : null;
    return { ok: true, customerId: id, uuid, customIdentifier };
  }
  const detail = extractRotessaErrors(json);
  const suffix = detail.length ? ` ${detail.join(" ")}` : "";
  if (httpStatus === 401) {
    return { ok: false, status: "error", message: "Rotessa rejected the API key (401). Reconnect in Settings.", httpStatus };
  }
  if (httpStatus === 422) {
    return { ok: false, status: "error", message: `Rotessa couldn't create the customer (422).${suffix}`, httpStatus };
  }
  if (httpStatus === 400) {
    return { ok: false, status: "error", message: `Rotessa rejected the customer details (400).${suffix}`, httpStatus };
  }
  if (httpStatus >= 500) {
    return { ok: false, status: "error", message: `Rotessa is temporarily unavailable (${httpStatus}). Try again shortly.`, httpStatus };
  }
  return { ok: false, status: "error", message: `Unexpected response from Rotessa (${httpStatus}).${suffix}`, httpStatus };
}

/**
 * Create a Rotessa customer (the only impure function for this increment).
 * POSTs the built body to /customers, parses the response, and never throws —
 * a network/timeout failure becomes a clean error result the caller can show.
 * 10s timeout.
 */
export async function createCustomer(
  apiKey: string,
  environment: RotessaEnvironment,
  input: RotessaCustomerInput,
): Promise<CreateCustomerResult> {
  const url = `${rotessaBaseUrl(environment)}/customers`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: rotessaAuthHeader(apiKey),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(buildCustomerBody(input)),
      signal: controller.signal,
      cache: "no-store",
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return parseCreateCustomerResponse(res.status, json);
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

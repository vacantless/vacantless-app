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

// ===========================================================================
// Increment 3 — create a Monthly rent schedule for a tenancy's customer.
//
// POST /transaction_schedules with the stored Rotessa customer id, the tenancy
// rent (amount is in DOLLARS in Rotessa's API), frequency "Monthly", and a
// first process_date. installments is omitted for an indefinite (ongoing)
// schedule. Rotessa requires the customer to have completed bank authorization
// before a schedule can be created — so a 422 here usually means the tenant
// still needs to authorize their bank directly in Rotessa.
//
// NOTE: process_date must be at least 2 business days in the future (Rotessa
// rule). The date helpers + body builder + response parser are PURE; only
// createSchedule does I/O.
//
// ⚠ UNVERIFIED-AGAINST-LIVE (S211): built from the published docs ahead of
// sandbox access. The pure pieces are unit-tested; the exact accepted
// process_date format ("Month D, YYYY", per the docs examples) is the most
// likely thing to adjust after the first live sandbox call.
// ===========================================================================

export const ROTESSA_FREQUENCY_MONTHLY = "Monthly" as const;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Parse "YYYY-MM-DD" into a UTC Date (date-only, no tz drift). null if bad. */
function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // round-trip guard (rejects e.g. 2027-02-31)
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

/** A UTC Date -> "YYYY-MM-DD". */
export function toIsoDate(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

/** Add n business days (skipping Sat/Sun) to a UTC date. Pure. */
export function addBusinessDays(start: Date, n: number): Date {
  const d = new Date(start.getTime());
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

/**
 * Earliest valid process date given "today" (ISO): today + 2 business days.
 * Pure (today is passed in, never read from the clock here).
 */
export function minProcessDate(todayIso: string): string {
  const today = parseIsoDate(todayIso) ?? new Date();
  return toIsoDate(addBusinessDays(today, 2));
}

/**
 * A sensible default first process date: the 1st of next month, bumped to the
 * earliest valid date if that's too soon (e.g. asked on the 31st). ISO string.
 */
export function defaultFirstProcessDate(todayIso: string): string {
  const today = parseIsoDate(todayIso) ?? new Date();
  const firstOfNext = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  const min = minProcessDate(todayIso);
  const candidate = toIsoDate(firstOfNext);
  return candidate < min ? min : candidate;
}

/** Is an ISO process date on/after the earliest valid date for `todayIso`? */
export function isValidProcessDate(processIso: string, todayIso: string): boolean {
  const p = parseIsoDate(processIso);
  if (!p) return false;
  return toIsoDate(p) >= minProcessDate(todayIso);
}

/**
 * Format an ISO date ("2027-01-01") as Rotessa's documented process_date
 * string ("January 1, 2027"). Returns "" for an unparseable input.
 */
export function formatProcessDate(processIso: string): string {
  const p = parseIsoDate(processIso);
  if (!p) return "";
  return `${MONTH_NAMES[p.getUTCMonth()]} ${p.getUTCDate()}, ${p.getUTCFullYear()}`;
}

export type RotessaScheduleInput = {
  customerId: string;
  amountCents: number;
  processDateIso: string;
  comment: string;
};

export type ScheduleInputValidation =
  | { ok: true; value: RotessaScheduleInput }
  | { ok: false; error: string };

/**
 * Validate everything we need to create a monthly schedule. Requires a Rotessa
 * customer id, a positive rent amount, and a process date at least 2 business
 * days out. `todayIso` is injected so this stays pure/testable.
 */
export function validateScheduleInput(
  raw: {
    customerId: string | null | undefined;
    amountCents: number | null | undefined;
    processDateIso: string | null | undefined;
    comment?: string | null;
  },
  todayIso: string,
): ScheduleInputValidation {
  const customerId = (raw.customerId ?? "").trim();
  if (!customerId) return { ok: false, error: "This tenancy has no Rotessa customer yet." };
  const amountCents = raw.amountCents ?? 0;
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false, error: "Set a monthly rent amount on this tenancy first." };
  }
  const processDateIso = (raw.processDateIso ?? "").trim();
  if (!isValidProcessDate(processDateIso, todayIso)) {
    return { ok: false, error: "Pick a first payment date at least 2 business days from today." };
  }
  const comment = (raw.comment ?? "").trim() || "Monthly rent via Vacantless";
  return { ok: true, value: { customerId, amountCents, processDateIso, comment } };
}

/** Cents -> a Rotessa amount number in DOLLARS (e.g. 125050 -> 1250.5). */
export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Build the POST /transaction_schedules body. amount is in dollars; frequency
 * is Monthly; process_date uses Rotessa's documented "Month D, YYYY" form;
 * installments is intentionally omitted (ongoing/indefinite). Pure.
 */
export function buildScheduleBody(input: RotessaScheduleInput): Record<string, unknown> {
  return {
    customer_id: input.customerId,
    amount: centsToAmount(input.amountCents),
    frequency: ROTESSA_FREQUENCY_MONTHLY,
    process_date: formatProcessDate(input.processDateIso),
    comment: input.comment,
  };
}

export type CreateScheduleResult =
  | { ok: true; scheduleId: string; nextProcessDate: string | null }
  | { ok: false; status: RotessaConnectionStatus; message: string; httpStatus?: number };

/**
 * Classify a POST /transaction_schedules response. Pure. A 2xx with a numeric
 * `id` is success. A 422 most often means the customer hasn't completed bank
 * authorization in Rotessa yet, or the process date is invalid — we surface
 * Rotessa's own error text so the operator knows which.
 */
export function parseCreateScheduleResponse(httpStatus: number, json: unknown): CreateScheduleResult {
  if (httpStatus >= 200 && httpStatus < 300) {
    const obj = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
    const rawId = obj.id;
    const id = typeof rawId === "number" ? String(rawId) : typeof rawId === "string" && rawId.trim() ? rawId.trim() : null;
    if (!id) {
      return { ok: false, status: "error", message: "Rotessa accepted the request but returned no schedule id.", httpStatus };
    }
    const nextProcessDate = typeof obj.next_process_date === "string" ? obj.next_process_date : null;
    return { ok: true, scheduleId: id, nextProcessDate };
  }
  const detail = extractRotessaErrors(json);
  const suffix = detail.length ? ` ${detail.join(" ")}` : "";
  if (httpStatus === 401) {
    return { ok: false, status: "error", message: "Rotessa rejected the API key (401). Reconnect in Settings.", httpStatus };
  }
  if (httpStatus === 422) {
    return {
      ok: false,
      status: "error",
      message: `Rotessa couldn't create the schedule (422).${suffix || " The tenant may still need to authorize their bank in Rotessa."}`,
      httpStatus,
    };
  }
  if (httpStatus === 400) {
    return { ok: false, status: "error", message: `Rotessa rejected the schedule (400).${suffix}`, httpStatus };
  }
  if (httpStatus >= 500) {
    return { ok: false, status: "error", message: `Rotessa is temporarily unavailable (${httpStatus}). Try again shortly.`, httpStatus };
  }
  return { ok: false, status: "error", message: `Unexpected response from Rotessa (${httpStatus}).${suffix}`, httpStatus };
}

/** Create a Monthly schedule (impure). Never throws; 10s timeout. */
export async function createSchedule(
  apiKey: string,
  environment: RotessaEnvironment,
  input: RotessaScheduleInput,
): Promise<CreateScheduleResult> {
  const url = `${rotessaBaseUrl(environment)}/transaction_schedules`;
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
      body: JSON.stringify(buildScheduleBody(input)),
      signal: controller.signal,
      cache: "no-store",
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return parseCreateScheduleResponse(res.status, json);
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

// ===========================================================================
// Rent financials export — read the landlord's transaction_report and turn it
// into a CSV. The report is the rent-income slice (amount, status, dates,
// custom_identifier) and is the tax-export angle. All parsing/formatting is
// PURE; only fetchTransactionReport does I/O.
// ===========================================================================

export type RotessaTransaction = {
  id: string | null;
  customIdentifier: string | null;
  customerId: string | null;
  amount: string | null; // Rotessa returns a dollar string e.g. "1250.00"
  processDate: string | null;
  settlementDate: string | null;
  status: string | null;
  statusReason: string | null;
  comment: string | null;
};

/** Normalize one raw transaction object from the report. Pure. */
export function normalizeTransaction(raw: unknown): RotessaTransaction {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
  return {
    id: str(o.id),
    customIdentifier: str(o.custom_identifier),
    customerId: str(o.customer_id),
    amount: str(o.amount),
    processDate: str(o.process_date),
    settlementDate: str(o.settlement_date),
    status: str(o.status),
    statusReason: str(o.status_reason),
    comment: str(o.comment),
  };
}

/** Parse the transaction_report payload (a JSON array) into normalized rows. */
export function parseTransactionReport(json: unknown): RotessaTransaction[] {
  if (!Array.isArray(json)) return [];
  return json.map(normalizeTransaction);
}

const CSV_HEADERS = [
  "Transaction ID",
  "Reference",
  "Customer ID",
  "Amount",
  "Process date",
  "Settlement date",
  "Status",
  "Status reason",
  "Comment",
];

/** RFC-4180 escape one CSV field. Pure. */
export function csvCell(value: string | null): string {
  const s = value ?? "";
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Turn normalized transactions into a CSV string (with header row). Pure. */
export function transactionsToCsv(rows: RotessaTransaction[]): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.customIdentifier,
        r.customerId,
        r.amount,
        r.processDate,
        r.settlementDate,
        r.status,
        r.statusReason,
        r.comment,
      ].map(csvCell).join(","),
    );
  }
  return lines.join("\r\n");
}

/** Build the transaction_report query string from an optional date range. Pure. */
export function buildReportQuery(opts: { startDate?: string | null; endDate?: string | null; status?: string | null }): string {
  const p = new URLSearchParams();
  if (opts.startDate) p.set("start_date", opts.startDate);
  if (opts.endDate) p.set("end_date", opts.endDate);
  if (opts.status) p.set("status", opts.status);
  const q = p.toString();
  return q ? `?${q}` : "";
}

export type TransactionReportResult =
  | { ok: true; transactions: RotessaTransaction[] }
  | { ok: false; message: string; httpStatus?: number };

/**
 * Fetch the transaction_report (impure). GET with an optional date range.
 * Never throws; 15s timeout (the report can be larger than a single record).
 */
export async function fetchTransactionReport(
  apiKey: string,
  environment: RotessaEnvironment,
  opts: { startDate?: string | null; endDate?: string | null; status?: string | null } = {},
): Promise<TransactionReportResult> {
  const url = `${rotessaBaseUrl(environment)}/transaction_report${buildReportQuery(opts)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
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
    if (res.status < 200 || res.status >= 300) {
      const classified = classifyConnectionStatus(res.status);
      return { ok: false, message: classified.message, httpStatus: res.status };
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: true, transactions: parseTransactionReport(json) };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
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

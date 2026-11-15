// S798: pure helpers for Rotessa rent on a tenancy: link an existing Rotessa
// customer by email, read Amount / Last payment / Next payment, and decide
// when a scheduled "last payment" stop may delete the schedule. No I/O here;
// the Rotessa calls live in lib/rotessa-rent.ts. Unit-tested in
// scripts/test-rotessa-rent.ts.
//
// Rotessa facts this relies on (S798):
//   * Customers cannot be deleted, only archived (PATCH /customers/{id}
//     { active: false }, proven live on the test customer 2026-11-15).
//     Archiving removes future transactions and blocks new ones.
//   * A transaction schedule can only be deleted while its next transaction
//     is still "Future". So a last-payment stop deletes the schedule only once
//     Rotessa has moved the schedule's next date past the last payment.

export type RotessaPaymentState = "paid" | "processing" | "failed";

export type RotessaScheduleInfo = {
  id: string;
  amountCents: number | null;
  frequency: string | null;
  nextProcessIso: string | null;
  processIso: string | null;
  installments: number | null;
};

export type RotessaTransactionInfo = {
  amountCents: number | null;
  status: string | null;
  processIso: string | null;
  scheduleId: string | null;
};

export type RotessaCustomerDetail = {
  id: string;
  name: string | null;
  email: string | null;
  active: boolean;
  customIdentifier: string | null;
  schedules: RotessaScheduleInfo[];
  transactions: RotessaTransactionInfo[];
};

function obj(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function idString(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Rotessa amounts are dollars ("1250.00" or 1250). -> integer cents. */
export function dollarsToCents(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** Accepts "2026-12-01", "2026-12-01T00:00:00-05:00" or "December 1, 2026". */
export function toIsoDay(v: unknown): string | null {
  const s = strOrNull(v);
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const long = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(s);
  if (long) {
    const m = MONTHS[long[1].toLowerCase()];
    if (!m) return null;
    return `${long[3]}-${String(m).padStart(2, "0")}-${String(Number(long[2])).padStart(2, "0")}`;
  }
  return null;
}

export function parseSchedule(raw: unknown): RotessaScheduleInfo | null {
  const o = obj(raw);
  const id = idString(o.id);
  if (!id) return null;
  const inst = typeof o.installments === "number" ? o.installments : null;
  return {
    id,
    amountCents: dollarsToCents(o.amount),
    frequency: strOrNull(o.frequency),
    nextProcessIso: toIsoDay(o.next_process_date),
    processIso: toIsoDay(o.process_date),
    installments: inst,
  };
}

export function parseTransaction(raw: unknown): RotessaTransactionInfo {
  const o = obj(raw);
  return {
    amountCents: dollarsToCents(o.amount),
    status: strOrNull(o.status),
    processIso: toIsoDay(o.process_date),
    scheduleId: idString(o.transaction_schedule_id),
  };
}

/** One customer from GET /customers or GET /customers/{id}. null if no id. */
export function parseCustomer(raw: unknown): RotessaCustomerDetail | null {
  const o = obj(raw);
  const id = idString(o.id);
  if (!id) return null;
  const schedules = Array.isArray(o.transaction_schedules)
    ? (o.transaction_schedules.map(parseSchedule).filter(Boolean) as RotessaScheduleInfo[])
    : [];
  const transactions = Array.isArray(o.financial_transactions)
    ? o.financial_transactions.map(parseTransaction)
    : [];
  return {
    id,
    name: strOrNull(o.name),
    email: strOrNull(o.email),
    // Rotessa omits nothing here in practice; treat a missing flag as active.
    active: o.active !== false,
    customIdentifier: strOrNull(o.custom_identifier),
    schedules,
    transactions,
  };
}

export function parseCustomerList(json: unknown): RotessaCustomerDetail[] {
  if (!Array.isArray(json)) return [];
  return json.map(parseCustomer).filter(Boolean) as RotessaCustomerDetail[];
}

export function normalizeEmail(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

export type PickByEmailResult =
  | { ok: true; customer: RotessaCustomerDetail }
  | { ok: false; code: "bademail" | "nomatch" | "many" | "archived" };

/**
 * Find exactly one ACTIVE Rotessa customer with this email. Two or more active
 * matches = refuse (the landlord must pick in Rotessa); only archived matches =
 * refuse (archived customers cannot be charged).
 */
export function pickCustomerByEmail(list: RotessaCustomerDetail[], email: unknown): PickByEmailResult {
  const want = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(want)) return { ok: false, code: "bademail" };
  const hits = list.filter((c) => normalizeEmail(c.email) === want);
  if (hits.length === 0) return { ok: false, code: "nomatch" };
  const live = hits.filter((c) => c.active);
  if (live.length === 0) return { ok: false, code: "archived" };
  if (live.length > 1) return { ok: false, code: "many" };
  return { ok: true, customer: live[0] };
}

/** Which schedule to link with the customer: only when there is exactly one. */
export function scheduleToLink(customer: RotessaCustomerDetail): string | null {
  return customer.schedules.length === 1 ? customer.schedules[0].id : null;
}

export type RotessaRentSummary = {
  amountCents: number | null;
  nextChargeIso: string | null;
  lastPaymentIso: string | null;
  lastPaymentCents: number | null;
  lastPaymentState: RotessaPaymentState | null;
  /** Day of month the schedule bills on, from its first process date. */
  anchorDay: number | null;
  scheduleFound: boolean;
};

export function paymentState(status: string | null): RotessaPaymentState | null {
  const s = (status ?? "").toLowerCase();
  if (s === "approved") return "paid";
  if (s === "pending") return "processing";
  if (s === "declined" || s === "chargeback") return "failed";
  return null; // "Future" and anything unknown is not a payment yet
}

/**
 * Amount / Last payment / Next payment for one schedule on a customer. Last
 * payment = the latest transaction that is no longer "Future". Transactions
 * are matched to the schedule when Rotessa says which schedule they belong to;
 * otherwise every customer transaction counts (one schedule per tenancy).
 */
export function summarizeRotessaRent(
  customer: RotessaCustomerDetail | null,
  scheduleId: string | null,
): RotessaRentSummary {
  const empty: RotessaRentSummary = {
    amountCents: null,
    nextChargeIso: null,
    lastPaymentIso: null,
    lastPaymentCents: null,
    lastPaymentState: null,
    anchorDay: null,
    scheduleFound: false,
  };
  if (!customer) return empty;
  const sched = scheduleId ? customer.schedules.find((s) => s.id === scheduleId) ?? null : null;
  const txs = customer.transactions.filter(
    (t) => !!t.processIso && paymentState(t.status) !== null && (!t.scheduleId || !scheduleId || t.scheduleId === scheduleId),
  );
  txs.sort((a, b) => (a.processIso! < b.processIso! ? 1 : a.processIso! > b.processIso! ? -1 : 0));
  const last = txs[0] ?? null;
  const anchorIso = sched?.processIso ?? sched?.nextProcessIso ?? null;
  return {
    amountCents: sched?.amountCents ?? null,
    nextChargeIso: sched?.nextProcessIso ?? null,
    lastPaymentIso: last?.processIso ?? null,
    lastPaymentCents: last?.amountCents ?? null,
    lastPaymentState: last ? paymentState(last.status) : null,
    anchorDay: anchorIso ? Number(anchorIso.slice(8, 10)) : null,
    scheduleFound: !!sched,
  };
}

/** Days after the last payment at which a scheduled stop deletes the schedule
 *  even if Rotessa has not moved its next date yet. Shorter than a month. */
export const ROTESSA_STOP_GRACE_DAYS = 14;

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Should the sweep delete this Rotessa schedule now? Only once the last
 * payment can no longer be cancelled by the delete: Rotessa has moved the
 * schedule's next date past it, or the grace period has run out. Never before
 * the last-payment date.
 */
export function decideRotessaScheduledStop(input: {
  stopAfterIso: string | null | undefined;
  todayIso: string;
  nextChargeIso: string | null | undefined;
  scheduleFound: boolean;
}): { stop: boolean; reason: "none" | "gone" | "before_date" | "taken" | "grace" | "waiting" } {
  const stopAfter = (input.stopAfterIso ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stopAfter)) return { stop: false, reason: "none" };
  if (!input.scheduleFound) return { stop: true, reason: "gone" };
  if (input.todayIso < stopAfter) return { stop: false, reason: "before_date" };
  if (input.todayIso >= addDays(stopAfter, ROTESSA_STOP_GRACE_DAYS)) return { stop: true, reason: "grace" };
  if (!input.nextChargeIso || input.nextChargeIso > stopAfter) return { stop: true, reason: "taken" };
  return { stop: false, reason: "waiting" };
}

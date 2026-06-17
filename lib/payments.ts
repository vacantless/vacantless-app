// Pure rent-payment domain model (no I/O) so it can be unit-tested in isolation.
//
// A rent payment is a manual bookkeeping record: money the landlord RECEIVED
// against a tenancy by e-transfer / cheque / cash (NOT a processor — Rotessa in
// lib/rotessa.ts handles pre-authorized debit). The landlord records what came
// in and reconciles it against the rent owed. See migration 0032 for the schema.
//
// The `method` value set is the payment-method abstraction: a small whitelist
// with a label map, deliberately easy to extend (the DB CHECK + this constant
// are the only two places to touch). We intentionally keep it to the manual
// rails — no PayPal/Plastiq/Chexy (fees / tenant-side).

export const PAYMENT_METHODS = ["e_transfer", "cheque", "cash", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const METHOD_LABELS: Record<PaymentMethod, string> = {
  e_transfer: "E-transfer",
  cheque: "Cheque",
  cash: "Cash",
  other: "Other",
};

export function paymentMethodLabel(method: string): string {
  return (METHOD_LABELS as Record<string, string>)[method] ?? method;
}

export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

// --- Parsing helpers --------------------------------------------------------

/** A dollar string ("1250", "1,250.50", "$1250") -> integer cents, or null. */
export function parseAmountToCents(raw: string | null | undefined): number | null {
  const v = (raw ?? "").replace(/[$,\s]/g, "");
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** An HTML date input ("YYYY-MM-DD") -> the value, or null if malformed/blank. */
export function parseDateOrNull(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * Normalize any "YYYY-MM-DD" (or a month input "YYYY-MM") to the FIRST of that
 * month ("YYYY-MM-01"), the canonical period key. Returns null for blank/bad.
 * Pure string work (no Date) so it can't drift across time zones.
 */
export function normalizePeriodMonth(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  const m = v.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!m) return null;
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

// --- Validation -------------------------------------------------------------

export type PaymentInput = {
  amountCents: number | null;
  method: string;
  paidOn: string | null;
};
export type PaymentValidation =
  | { ok: true; value: { amountCents: number; method: PaymentMethod; paidOn: string } }
  | { ok: false; code: string };

/**
 * Validate a record-payment submission. Requires a positive amount, a known
 * method, and a valid paid-on date. Returns a stable error code for the page's
 * `?paid=` param on failure, or the cleaned values on success.
 */
export function validatePaymentInput(v: PaymentInput): PaymentValidation {
  if (v.amountCents == null || v.amountCents <= 0) return { ok: false, code: "amount" };
  if (!isPaymentMethod(v.method)) return { ok: false, code: "method" };
  if (!v.paidOn) return { ok: false, code: "date" };
  return { ok: true, value: { amountCents: v.amountCents, method: v.method, paidOn: v.paidOn } };
}

const ERROR_MESSAGES: Record<string, string> = {
  amount: "Enter a payment amount greater than zero.",
  method: "Pick how the payment was made.",
  date: "Enter the date the payment was received.",
  forbidden: "You don't have permission to record payments.",
  notfound: "That payment could not be found.",
};

export function paymentErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? "Something went wrong. Please check the form.";
}

// --- Formatting -------------------------------------------------------------

/** Integer cents -> "$1,250.00" (always two decimals — it's a ledger). */
export function formatMoneyCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "2026-06-01" -> "June 2026". Pure (parses the string, no Date/tz drift). */
export function formatPeriodMonth(period: string | null | undefined): string {
  const v = (period ?? "").trim();
  const m = v.match(/^(\d{4})-(\d{2})/);
  if (!m) return "Unassigned";
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const idx = parseInt(m[2], 10) - 1;
  if (idx < 0 || idx > 11) return "Unassigned";
  return `${months[idx]} ${m[1]}`;
}

// --- Reconciliation ---------------------------------------------------------

export type PaymentRow = {
  amount_cents: number;
  period_month: string | null;
};

export type PeriodBucket = {
  /** The period key ("YYYY-MM-01"), or null for the Unassigned bucket. */
  period: string | null;
  label: string;
  collectedCents: number;
  /** Rent expected for an assigned period (null for Unassigned). */
  expectedCents: number | null;
  /** collected - expected (null for Unassigned). Positive = over, negative = short. */
  balanceCents: number | null;
  status: "paid" | "short" | "over" | "unassigned";
  count: number;
};

export type Reconciliation = {
  totalCollectedCents: number;
  buckets: PeriodBucket[];
};

/**
 * Reconcile a tenancy's payments against the monthly rent. Groups payments by
 * `period_month`; each assigned period is compared to `rentCents` (paid / short
 * / over). Payments with no period fall into a single "Unassigned" bucket with
 * no expected amount. Buckets are sorted most-recent period first, with
 * Unassigned last. Pure.
 */
export function reconcilePayments(
  payments: PaymentRow[],
  rentCents: number | null,
): Reconciliation {
  const byPeriod = new Map<string | null, { collected: number; count: number }>();
  let total = 0;

  for (const p of payments) {
    const amt = p.amount_cents;
    total += amt;
    const key = p.period_month ?? null;
    const cur = byPeriod.get(key) ?? { collected: 0, count: 0 };
    cur.collected += amt;
    cur.count += 1;
    byPeriod.set(key, cur);
  }

  const buckets: PeriodBucket[] = [];
  for (const [period, agg] of byPeriod.entries()) {
    if (period == null) {
      buckets.push({
        period: null,
        label: "Unassigned",
        collectedCents: agg.collected,
        expectedCents: null,
        balanceCents: null,
        status: "unassigned",
        count: agg.count,
      });
      continue;
    }
    const expected = rentCents != null && rentCents > 0 ? rentCents : null;
    const balance = expected != null ? agg.collected - expected : null;
    let status: PeriodBucket["status"] = "paid";
    if (balance != null) {
      if (balance < 0) status = "short";
      else if (balance > 0) status = "over";
      else status = "paid";
    } else {
      status = "paid"; // no expected rent set -> just show what was collected
    }
    buckets.push({
      period,
      label: formatPeriodMonth(period),
      collectedCents: agg.collected,
      expectedCents: expected,
      balanceCents: balance,
      status,
      count: agg.count,
    });
  }

  // Most-recent assigned period first; Unassigned always last.
  buckets.sort((a, b) => {
    if (a.period == null) return 1;
    if (b.period == null) return -1;
    return b.period.localeCompare(a.period);
  });

  return { totalCollectedCents: total, buckets };
}

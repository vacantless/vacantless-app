// S835c: NSF charges on a tenancy (pure half). A failed rent debit costs the
// landlord a fee; this is the record of what the tenant may be asked to pay
// back. Vacantless never debits it. The server half is lib/nsf-charge-server.ts.

import { STRIPE_PAD } from "@/lib/rent-rail-costs";

/** Stripe's failed bank debit fee, from the one place its prices live. */
export const STRIPE_NSF_FEE_CENTS = STRIPE_PAD.failedCents;

/** Ontario's cap on the landlord's own admin charge (O. Reg. 516/06, s. 17). */
export const NSF_ADMIN_MAX_CENTS = 2000;

/** The most a bank charge line will take, to catch a typo like 5000 for 50. */
export const NSF_BANK_MAX_CENTS = 100000;

export const NSF_RULE_URL = "https://www.ontario.ca/laws/regulation/060516";

/** The guidance under the NSF charges list. Plain words; not legal advice. */
export const NSF_GUIDANCE: readonly string[] = [
  "Ontario lets you pass on what the bank charged you for an NSF payment.",
  "It also allows an admin charge of up to $20 for an NSF cheque. The rule names cheques. For a failed bank debit, the admin charge is not settled.",
  "Keep NSF charges off an N4. The L1 and L9 forms have their own place for NSF cheque charges.",
  "This is a record of what is owed. Vacantless never takes it from your tenant's bank.",
  "This is general information, not legal advice. Check with a paralegal before you charge it. Outside Ontario, check your own province's rule.",
];

export type NsfChargeInput = {
  incurredOn: string;
  bankChargeCents: number;
  adminChargeCents: number;
  note: string | null;
};

export type NsfChargeValidation =
  | { ok: true; value: NsfChargeInput }
  | { ok: false; code: "date" | "bank" | "admin" | "empty" };

function moneyToCents(raw: string | null | undefined): number | null {
  const v = (raw ?? "").replace(/[$,\s]/g, "");
  if (!v) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(parseFloat(v) * 100);
}

/** Check what the landlord typed. The admin charge can never pass $20. Pure. */
export function validateNsfCharge(raw: {
  incurredOn: string | null | undefined;
  bankCharge: string | null | undefined;
  adminCharge: string | null | undefined;
  note: string | null | undefined;
}): NsfChargeValidation {
  const date = (raw.incurredOn ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return { ok: false, code: "date" };
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return { ok: false, code: "date" };
  const bank = moneyToCents(raw.bankCharge);
  if (bank == null || bank > NSF_BANK_MAX_CENTS) return { ok: false, code: "bank" };
  const admin = moneyToCents(raw.adminCharge);
  if (admin == null || admin > NSF_ADMIN_MAX_CENTS) return { ok: false, code: "admin" };
  if (bank + admin === 0) return { ok: false, code: "empty" };
  const note = (raw.note ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null;
  return { ok: true, value: { incurredOn: date, bankChargeCents: bank, adminChargeCents: admin, note } };
}

export type NsfChargeRow = {
  id: string;
  incurred_on: string;
  bank_charge_cents: number;
  admin_charge_cents: number;
  note: string | null;
  source: string;
  paid_at: string | null;
};

export function nsfChargeTotalCents(row: Pick<NsfChargeRow, "bank_charge_cents" | "admin_charge_cents">): number {
  return (row.bank_charge_cents ?? 0) + (row.admin_charge_cents ?? 0);
}

/** What the tenant still owes in NSF charges (unpaid rows only). Pure. */
export function nsfOwingCents(rows: readonly NsfChargeRow[]): number {
  return rows.filter((r) => !r.paid_at).reduce((n, r) => n + nsfChargeTotalCents(r), 0);
}

/** "$5", "$12.50": cents shown only when there are some. */
export function nsfMoney(cents: number): string {
  const v = cents / 100;
  return `$${v.toLocaleString("en-CA", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** The value for a money box: "5.00". */
export function nsfInputValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** The expense note for the fee Vacantless records itself. Pure. */
export function nsfExpenseNote(tenantName: string | null | undefined): string {
  const who = (tenantName ?? "").trim();
  return `Failed rent payment fee${who ? `, ${who}` : ""}. Recorded by Vacantless.`;
}

export const NSF_MESSAGES: Record<string, { tone: "ok" | "error"; text: string }> = {
  added: { tone: "ok", text: "NSF charge added." },
  saved: { tone: "ok", text: "NSF charge saved." },
  paid: { tone: "ok", text: "Marked as paid." },
  unpaid: { tone: "ok", text: "Marked as not paid." },
  removed: { tone: "ok", text: "NSF charge removed." },
  date: { tone: "error", text: "Pick the date the payment failed." },
  bank: { tone: "error", text: "Type the bank charge as dollars, like 5.00." },
  admin: { tone: "error", text: "The admin charge can be $20 at most. Nothing was saved." },
  empty: { tone: "error", text: "Type a bank charge or an admin charge." },
  fail: { tone: "error", text: "We couldn't save that. Try again." },
  forbidden: { tone: "error", text: "Your sign-in can't change rent records." },
};

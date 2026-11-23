// S835d: failed Rotessa rent debits (pure half). Rotessa does not tell
// Vacantless when a payment fails, so the rent sweep reads the transaction
// report a few times a day. The server half is lib/rotessa-nsf-server.ts.

import type { RotessaTransaction } from "@/lib/rotessa";
import { ROTESSA } from "@/lib/rent-rail-costs";

/** Rotessa's fee for an NSF or stopped payment, from the one price file. */
export const ROTESSA_NSF_FEE_CENTS = ROTESSA.nsfCents;

/** How far back each read looks. A failure shows within a few business days. */
export const ROTESSA_NSF_LOOKBACK_DAYS = 14;

/** Toronto hours the read runs in (the sweep itself runs every half hour). */
export const ROTESSA_NSF_HOURS: readonly number[] = [8, 14, 20];

export function rotessaNsfDue(torontoHour: number): boolean {
  return ROTESSA_NSF_HOURS.includes(torontoHour);
}

/** A transaction the bank sent back: declined, or charged back later. Pure. */
export function isFailedRotessaTransaction(t: Pick<RotessaTransaction, "status">): boolean {
  const s = (t.status ?? "").trim().toLowerCase();
  return s === "declined" || s === "chargeback";
}

export function rotessaNsfRef(transactionId: string): string {
  return `rotessa:${transactionId.trim()}`;
}

/** The note on the charge, with Rotessa's own reason when it gave one. Pure. */
export function rotessaNsfNote(statusReason: string | null | undefined): string {
  const why = (statusReason ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return why ? `Rotessa's fee for the failed bank debit (${why}).` : "Rotessa's fee for the failed bank debit.";
}

/** The day the payment was due, from Rotessa's process date. Pure. */
export function rotessaNsfDate(processDate: string | null | undefined, todayIso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec((processDate ?? "").trim());
  return m ? m[1] : todayIso;
}

/** Dollars from Rotessa's amount string ("1250.00") to cents, or null. Pure. */
export function rotessaAmountCents(amount: string | null | undefined): number | null {
  const v = (amount ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(parseFloat(v) * 100);
}

/** today minus n days, as YYYY-MM-DD. Pure. */
export function isoDaysAgo(todayIso: string, days: number): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) - days, 12)).toISOString().slice(0, 10);
}

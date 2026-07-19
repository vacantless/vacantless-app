// Pure domain logic for "record rent from a bank credit" (S417). No I/O so it
// unit-tests in isolation. A rent deposit lands as ONE bank credit but can cover
// several tenancies (e.g. a Rotessa lump), so the operator splits it across the
// org's active tenancies into rent_payments rows the owner statement already
// sums. We never move money — this only records what already arrived.

/** Dark flag: the credit "is any of this rent?" lane is hidden until the env var
 * is set (mirrors the codebase's env-gated features). Flip RENT_FROM_BANK=1 in
 * the deploy env to enable; off everywhere by default so it ships dark. */
export function isRentFromBankEnabled(): boolean {
  return process.env.RENT_FROM_BANK === "1";
}

export type SplitTenancy = { tenancyId: string; rentCents: number | null };
export type SplitAllocation = { tenancyId: string; amountCents: number };

/**
 * Pre-fill the split: give each tenancy its monthly rent, in order, but never
 * allocate more than the credit total (a later tenancy is capped by whatever is
 * left). A tenancy with no known rent pre-fills 0. Pure; total never exceeds the
 * credit. This is only a suggestion — the operator can edit every amount.
 */
export function prefillRentSplit(creditCents: number, tenancies: SplitTenancy[]): SplitAllocation[] {
  let remaining = Math.max(0, creditCents);
  const out: SplitAllocation[] = [];
  for (const t of tenancies) {
    const want = Math.max(0, t.rentCents ?? 0);
    const amt = Math.min(want, remaining);
    out.push({ tenancyId: t.tenancyId, amountCents: amt });
    remaining -= amt;
  }
  return out;
}

export type RentSplitValidation =
  | { ok: true; value: SplitAllocation[] }
  | { ok: false; code: string };

/**
 * Validate operator-entered allocations against the credit amount. Keeps only
 * the positive allocations; requires at least one; the total may be LESS than
 * the credit (part of the deposit isn't rent) but never MORE (you can't record
 * more rent than money received). Pure.
 */
export function validateRentSplit(
  creditCents: number,
  allocations: SplitAllocation[],
): RentSplitValidation {
  const positive = allocations.filter((a) => a.amountCents > 0);
  if (positive.length === 0) return { ok: false, code: "empty" };
  const total = positive.reduce((sum, a) => sum + a.amountCents, 0);
  if (total > creditCents) return { ok: false, code: "over" };
  return { ok: true, value: positive };
}

const RENT_ERROR_MESSAGES: Record<string, string> = {
  empty: "Enter a rent amount for at least one tenancy.",
  over: "The amounts add up to more than the deposit. Lower them and try again.",
  notenancy: "Pick which tenancy the rent belongs to.",
  locked: "Recording rent from the bank isn't enabled yet.",
  notfound: "That deposit could not be found.",
  rail_duplicate: "That deposit looks like rent already recorded by Stripe or Rotessa. Link it instead of recording a second payment.",
  link_mismatch: "That rent payment no longer matches this deposit. Refresh and try again.",
  link_taken: "That rent payment is already linked to a bank deposit.",
  save: "Couldn't record the rent. Please try again.",
};

export function rentFromBankErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return RENT_ERROR_MESSAGES[code] ?? "Something went wrong. Please check the amounts.";
}

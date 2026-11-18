// S818: credit checks, one per vacancy. Noam 2026-11-18 ("can we put the cost
// on the tenant", then "yes - please ensure its woven through properly").
// Ontario: the Residential Tenancies Act lets a landlord ask for consent to a
// credit check (O. Reg. 290/98 s. 1) but not charge the applicant for it, so
// the landlord pays and runs it only on the applicant they pick. Before that,
// a free look at published Landlord and Tenant Board orders on CanLII.
// One source for the rule's words: every surface imports them from here.

/** Ontario postal codes start with K, L, M, N or P. */
const ON_POSTAL = /^[KLMNP]\d[A-Z]\s?\d[A-Z]\d$/i;

/** True when the rental is in Ontario, read from its postal code or address. */
export function isOntarioRental(p: { postal_code?: string | null; address?: string | null } | null | undefined): boolean {
  if (!p) return false;
  const pc = (p.postal_code ?? "").trim();
  if (pc && ON_POSTAL.test(pc)) return true;
  const addr = p.address ?? "";
  if (/,\s*(ON|Ontario)\b/i.test(addr)) return true;
  const m = addr.match(/\b([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b/i);
  return !!m && ON_POSTAL.test(`${m[1]}${m[2]}`);
}

/** CanLII search of Ontario Landlord and Tenant Board decisions for one name (free, no sign-in). */
export function ltbSearchUrl(name: string | null | undefined): string | null {
  const n = (name ?? "").replace(/["<>]/g, " ").replace(/\s+/g, " ").trim();
  if (n.length < 3) return null;
  return `https://www.canlii.org/en/#search/type=decision&ccId=onltb&text=${encodeURIComponent(`"${n}"`)}`;
}

/** The rule, in the words every surface uses. */
export const CREDIT_CHECK_ONE_LINE =
  "Run a credit check only on the applicant you pick. Applicants get your link when you press Ask for credit check.";
export const CREDIT_CHECK_ONTARIO_LINE =
  "In Ontario you pay for the credit check. You can't charge the applicant for it.";
export const LTB_CHECK_LINE =
  "Free first: search their name in Landlord and Tenant Board orders. Only published orders show up, so no result does not mean no history.";

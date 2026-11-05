// S751: official LTB Form L9 (2026/09) fill. Prepare-only: the landlord checks
// it, signs it and files it (Tribunals Ontario Portal, mail, courier or a
// ServiceOntario centre). Nothing is filed for them.
//
// FORM MAP (2026/09, 116 widgets, 10 pages incl. a removable checklist; read
// with pdf.js on 2026-11-05): the same field names as the L1 (2026/09) for
// Parts 1 to 7, without Part4.DepositAmount / DepositDate / DepositDateFrom /
// DepositDateTo. So it uses the L1's filler with the deposit boxes off.

import { fillLtbRentClaim } from "@/lib/l1-official-pdf";
import type { N4FormRow } from "@/lib/n4";

export const L9_TEMPLATE_REL = "lib/forms/ltb-l9-2026.pdf";
export const L9_TEMPLATE_VERSION = "2026/09";

export type L9FillInput = {
  rentalUnitAddress: string | null;
  filingDateISO: string;
  landlord: {
    firstName?: string | null;
    lastName?: string | null;
    company?: string | null;
    email?: string | null;
    phone?: string | null;
    mailingAddress?: string | null;
    byEmail: boolean;
  };
  tenants: { name: string; email?: string | null; phone?: string | null }[];
  rows: N4FormRow[];
  rentOwingCents: number;
  nsfCents: number;
  feeCents: number;
  totalCents: number;
  french?: boolean;
};

export async function fillOfficialL9(d: L9FillInput): Promise<Uint8Array> {
  return fillLtbRentClaim(L9_TEMPLATE_REL, "fillOfficialL9", { ...d, deposit: null }, { hasDeposit: false });
}

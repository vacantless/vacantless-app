// Shared comb-cell formatters for the official LTB PDF forms. A COMB field places
// each character in its own fixed cell; where the government template PRE-PRINTS a
// separator ('/', '.'), we must feed a BLANK in that cell so the value doesn't
// double it (the "cents in twice" class of bug from the N1 build). Generalized so
// each form (N1 fixed 9/10-cell; N4's 9/10/11-cell amounts) reuses one toolkit.
//
// NOTE: lib/n1-official-pdf.ts keeps its own verified copies (v.01/04/2022); this
// module is the go-forward shared version used by the N4 lane and beyond.

/**
 * Amount in integer cents -> an N-cell comb string. Layout, right-aligned:
 *   [ dollar cells ... ][ 1 blank over the pre-printed "." ][ cc ]
 * so `cells` = dollarCells + 1 + 2  =>  dollarCells = cells - 3. Leading dollar
 * cells are spaces (blank), pushing the number to the right. THROWS rather than
 * silently truncate an amount whose dollars exceed the available cells (a dropped
 * leading digit on a legal notice is worse than a hard failure).
 */
export function combAmountCents(cents: number, cells = 9): string {
  const dollarCells = cells - 3;
  if (dollarCells < 1) throw new Error(`comb: field too narrow (${cells} cells)`);
  const v = Math.max(0, Math.round(cents || 0));
  const dstr = String(Math.floor(v / 100));
  if (dstr.length > dollarCells) {
    throw new Error(
      `comb: amount $${dstr} exceeds the ${dollarCells}-dollar-cell comb (field width ${cells})`,
    );
  }
  const dollars = dstr.padStart(dollarCells, " ");
  const c = String(v % 100).padStart(2, "0");
  return `${dollars} ${c}`; // dollarCells + 1 blank (pre-printed ".") + 2 cents
}

/**
 * ISO YYYY-MM-DD -> a 10-cell date comb "DD MM YYYY" (single blanks over the two
 * pre-printed "/" at cells 3 & 6). Returns null for an unparseable input so the
 * caller can leave the field blank rather than stamp a wrong date.
 */
export function combDateISO(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
  if (!m) return null;
  const [, Y, M, D] = m;
  return `${D} ${M} ${Y}`; // 2 + 1(blank "/") + 2 + 1(blank "/") + 4 = 10
}

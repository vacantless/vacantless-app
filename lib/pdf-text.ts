// ============================================================================
// pdf.js text-content items -> newline-separated plain text (PURE).
// No DOM / pdfjs import / IO — fully unit-testable (see scripts/test-pdf-text.ts).
//
// PURPOSE (S292): the MLS data-sheet PDF-drop import. A realtor exports their
// OWN authorized listing as a PDF (Client Full / data sheet — downloaded or
// emailed to themselves), drops it on the Add-a-Rental prefill card, and the
// client-side island runs pdf.js to read each page's text content. pdf.js hands
// back an array of positioned text ITEMS, not a tidy string; this module turns
// those items into the SAME newline-separated paste text that the existing
// `parseMlsListing` (lib/mls-import) already understands. So the PDF path is
// purely an alternative ACQUISITION of the text the paste box already accepts —
// no new parser, no server change, no scrape, no board API.
//
// DATA-SOURCE DISCIPLINE: this only INTERPRETS bytes the operator already holds
// and chose to drop in. It makes no network call and never touches the licensed
// MLS portal (the rejected REALM/extension scraper). See
// MLS-IMPORT-COMPLIANCE-DECISION-2026-06-21.md.
//
// WHY A PURE MODULE: the actual pdf.js load is impure (browser worker, async),
// but the item->text assembly is deterministic and is where the only real logic
// lives, so it lives here behind a minimal item shape and is unit-tested against
// the two shapes pdf.js produces in the wild (verified empirically against
// pdfjs-dist 4.7.76 on a generated data sheet, 2026-06-21):
//   1. Modern pdf.js sets `hasEOL` on the item that ends each visual line, and
//      keeps words + inter-column spaces inside `.str` (or as their own " "
//      items). So concatenating `.str` in reading order and breaking on `hasEOL`
//      reproduces the line structure faithfully — the PRIMARY path.
//   2. Older / `hasEOL`-less output: fall back to clustering items by their Y
//      coordinate (transform[5]) into rows, ordering each row left-to-right by X
//      (transform[4]). Deterministic and version-independent.
// ============================================================================

/**
 * The minimal slice of a pdf.js `TextItem` this module consumes. Declared
 * locally (not imported from pdfjs-dist) so this stays a pure, dependency-free,
 * test-only-on-data module. `transform` is pdf.js's 6-number matrix where
 * index 4 = x and index 5 = y (PDF user space, y increasing UPWARD).
 */
export interface PdfTextItemLike {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
}

/** Collapse intra-line runs of whitespace to single spaces and trim the ends. */
function tidyLine(s: string): string {
  return s.replace(/[ \t ]+/g, " ").trim();
}

/**
 * Assemble ONE page's text-content items into newline-separated text.
 *
 * Primary path (`hasEOL` present on any item): walk items in reading order,
 * accumulating `.str` into the current line and flushing a newline whenever an
 * item is flagged end-of-line. Empty lines are dropped after tidying.
 *
 * Fallback path (no `hasEOL` anywhere): cluster by Y. Sort items top-to-bottom
 * (descending y, since PDF y grows upward), split into a new row whenever the y
 * gap to the previous item exceeds `yTolerance`, then order each row by ascending
 * x and join with spaces. Items with no usable string are skipped.
 */
export function assemblePageText(
  items: PdfTextItemLike[],
  opts: { yTolerance?: number } = {},
): string {
  if (!items || items.length === 0) return "";

  const anyEol = items.some((it) => typeof it.hasEOL === "boolean");
  if (anyEol) {
    const lines: string[] = [];
    let buf = "";
    for (const it of items) {
      buf += it.str ?? "";
      if (it.hasEOL) {
        const tidy = tidyLine(buf);
        if (tidy) lines.push(tidy);
        buf = "";
      }
    }
    const tail = tidyLine(buf);
    if (tail) lines.push(tail);
    return lines.join("\n");
  }

  // Fallback: Y-coordinate clustering.
  const yTol = opts.yTolerance ?? 3;
  const positioned = items
    .map((it) => ({
      str: it.str ?? "",
      x: it.transform?.[4] ?? 0,
      y: it.transform?.[5] ?? 0,
    }))
    .filter((it) => it.str.length > 0);
  if (positioned.length === 0) return "";

  // Stable top-to-bottom order (numeric, not a tolerance comparator, so the sort
  // stays a valid total order); row splitting is done explicitly below.
  positioned.sort((a, b) => b.y - a.y);

  const rows: { str: string; x: number }[][] = [];
  let current: { str: string; x: number }[] = [];
  let rowY: number | null = null;
  for (const it of positioned) {
    if (rowY === null || Math.abs(it.y - rowY) <= yTol) {
      current.push(it);
      if (rowY === null) rowY = it.y;
    } else {
      rows.push(current);
      current = [it];
      rowY = it.y;
    }
  }
  if (current.length) rows.push(current);

  return rows
    .map((row) =>
      tidyLine(
        row
          .slice()
          .sort((a, b) => a.x - b.x)
          .map((it) => it.str)
          .join(" "),
      ),
    )
    .filter((l) => l.length > 0)
    .join("\n");
}

/**
 * Assemble a whole document (an array of per-page item arrays) into one text
 * blob, pages separated by a newline so a label that lands on page 2 of a
 * multi-page data sheet still parses. Blank pages contribute nothing.
 */
export function assembleDocumentText(pages: PdfTextItemLike[][]): string {
  return pages
    .map((items) => assemblePageText(items))
    .filter((t) => t.length > 0)
    .join("\n");
}

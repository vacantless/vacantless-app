"use client";

import { SECONDARY_ACTION_CLASS } from "@/components/ui";

/**
 * Triggers the browser print dialog so the owner can save the rent roll as a
 * branded PDF (the dashboard chrome is hidden on print via the layout's
 * print:hidden + the page's print:hidden controls). v1 "PDF" = print-to-PDF; a
 * server-rendered PDF + a live shareable link are the v2 follow-ups.
 */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={SECONDARY_ACTION_CLASS}>
      Print / Save PDF
    </button>
  );
}

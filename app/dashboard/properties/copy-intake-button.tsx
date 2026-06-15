"use client";

import { useState } from "react";

/**
 * Compact "Copy intake link" button for the Properties list rows. Same
 * clipboard behavior as the full CopyLink on the detail page, but a single
 * small button so it fits inline on a row without crowding it.
 */
export function CopyIntakeButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable; the detail page has a selectable field.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
    >
      {copied ? "Copied!" : "Copy intake link"}
    </button>
  );
}

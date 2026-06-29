"use client";

import { useState } from "react";

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable; the input is selectable as a fallback.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        readOnly
        aria-label="Public listing link"
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-[18rem] flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700"
      />
      <button
        type="button"
        onClick={copy}
        className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white"
      >
        {copied ? "Copied!" : "Copy link"}
      </button>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Open
      </a>
    </div>
  );
}

"use client";

import { useState } from "react";

// Copies a RAW value (not a URL) to the clipboard — e.g. the email-in capture
// address u-<token>@in.vacantless.com, which must be copied verbatim (unlike
// CopyLinkButton, which prepends the origin for signing links).
export function CopyTextButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this:", value);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

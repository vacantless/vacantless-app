"use client";

import { useState } from "react";

// Copies an absolute URL (origin + the given path) to the clipboard. Used to
// hand a tenant's private /sign magic-link to the operator so they can send it
// manually in addition to the best-effort email (lease vault #11, slice 4).
export function CopyLinkButton({
  path,
  label = "Copy link",
}: {
  path: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url =
      typeof window !== "undefined" ? window.location.origin + path : path;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — fall back to a prompt so the operator can still grab it.
      window.prompt("Copy this signing link:", url);
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

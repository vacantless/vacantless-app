"use client";

import { useRef, useState } from "react";
import { copyToClipboard } from "@/lib/copy-to-clipboard";

export function CopyLink({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  async function copy() {
    const ok = await copyToClipboard(url);
    if (ok) {
      setState("copied");
      setTimeout(() => setState("idle"), 1500);
    } else {
      // Both the Clipboard API and the execCommand fallback were blocked:
      // select the field so the operator can finish with Ctrl/Cmd-C, and
      // flag it on the button rather than silently doing nothing.
      inputRef.current?.focus();
      inputRef.current?.select();
      setState("manual");
      setTimeout(() => setState("idle"), 2500);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
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
        {state === "copied"
          ? "Copied!"
          : state === "manual"
            ? "Copy failed"
            : "Copy link"}
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

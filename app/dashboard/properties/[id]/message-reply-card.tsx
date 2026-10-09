"use client";

import { useState } from "react";
import { copyToClipboard } from "@/lib/copy-to-clipboard";

// S702: one-tap reply for renters who message instead of clicking the link.
export function MessageReplyCard({ reply }: { reply: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    const ok = await copyToClipboard(reply);
    setState(ok ? "copied" : "failed");
    setTimeout(() => setState("idle"), 1800);
  }

  return (
    <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">
          Reply to renter messages
        </h3>
        <button
          type="button"
          onClick={copy}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white"
        >
          {state === "copied" ? "Copied!" : state === "failed" ? "Copy failed" : "Copy reply"}
        </button>
      </div>
      <p className="mb-2 text-sm text-gray-600">
        When a renter asks if it is still available, paste this. It sends them
        to your booking page.
      </p>
      <textarea
        readOnly
        aria-label="Reply to renter messages"
        rows={3}
        value={reply}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full resize-y rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800"
      />
    </section>
  );
}

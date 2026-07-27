"use client";

import { useState } from "react";
import { copyToClipboard } from "@/lib/copy-to-clipboard";

export function InquiryReplyPanel({
  email,
  phone,
  subject,
  body,
}: {
  email: string | null;
  phone: string | null;
  subject: string;
  body: string;
}) {
  const [text, setText] = useState(body);
  const [copied, setCopied] = useState(false);

  const mailto = email
    ? `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`
    : undefined;

  async function onCopy() {
    if (await copyToClipboard(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div
      id="reply"
      className="mt-8 scroll-mt-6 rounded-2xl border border-brand/30 bg-brand/5 p-4"
    >
      <h3 className="text-sm font-semibold text-gray-900">
        Reply to this renter
      </h3>
      <p className="mb-2 text-xs text-gray-500">
        Edit the message, then send it from your own email or copy it. Nothing
        is sent automatically.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        aria-label="Reply message"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {mailto ? (
          <a
            href={mailto}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
          >
            Open in email
          </a>
        ) : (
          <span className="text-xs text-gray-500">
            No email on file{phone ? `. Call ${phone}.` : "."}
          </span>
        )}
        <button
          type="button"
          onClick={onCopy}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {copied ? "Copied!" : "Copy message"}
        </button>
      </div>
    </div>
  );
}

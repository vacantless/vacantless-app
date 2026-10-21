"use client";

import { useState } from "react";

// S728: the "subscribe once" calendar link. Shown on Viewings (the whole
// account) and beside each showing agent (their viewings only).
export function CalendarFeedLink({ url, label = "Add to Google or Apple Calendar" }: { url: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!url) return null;
  const webcal = url.replace(/^https?:\/\//, "webcal://");
  return (
    <span className="inline-block text-sm">
      <button type="button" onClick={() => setOpen((v) => !v)} className="font-medium text-brand hover:underline">
        {label}
      </button>
      {open && (
        <span className="mt-2 block max-w-xl rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600 shadow-sm">
          <span className="block">
            Subscribe once and every viewing shows up in your calendar, with moves and cancellations. It
            refreshes on the calendar&apos;s own schedule (Google: a few hours; Apple and Outlook: as you set it).
          </span>
          <span className="mt-2 block">
            <strong>Google Calendar:</strong> Other calendars, plus, From URL, paste this link.{" "}
            <strong>Apple:</strong> open the webcal link below.
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-2">
            <code className="max-w-full truncate rounded bg-gray-50 px-2 py-1">{url}</code>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  setCopied(false);
                }
              }}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-50"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            <a href={webcal} className="rounded-lg border border-gray-300 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-50">
              Open in Apple Calendar
            </a>
          </span>
          <span className="mt-2 block text-gray-400">Anyone with this link can see your viewings. Keep it private.</span>
        </span>
      )}
    </span>
  );
}

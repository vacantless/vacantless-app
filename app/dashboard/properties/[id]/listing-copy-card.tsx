"use client";

import { useState } from "react";

/**
 * "Listing copy for each channel" card. Shows ready-to-paste title + body copy
 * for every advertising portal, with per-portal tabs and copy-to-clipboard.
 * The copy itself is generated server-side (lib/listing-copy) from the unit's
 * real fields and passed in here — this component is purely presentational +
 * clipboard, so the house copy rules live in one tested place.
 */

export type CopyTab = {
  key: string;
  label: string;
  title: string;
  body: string;
};

export function ListingCopyCard({
  tabs,
  descriptionThin = false,
}: {
  tabs: CopyTab[];
  // True when the saved description is empty/very short. The channel copy below
  // is built from the description, so a thin one yields a field-summary ad -
  // surface a nudge into the Description Helper instead of letting it ship flat.
  descriptionThin?: boolean;
}) {
  const [active, setActive] = useState(tabs[0]?.key ?? "generic");
  // Which field was most recently copied, so we can flash "Copied!" on it.
  const [copied, setCopied] = useState<string | null>(null);

  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  async function copy(text: string, field: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(field);
      setTimeout(() => setCopied((c) => (c === field ? null : c)), 1500);
    } catch {
      // Clipboard may be unavailable; the textarea below is selectable as a
      // fallback so the operator can still copy manually.
    }
  }

  if (!current) return null;

  const fullText = `${current.title}\n\n${current.body}`;

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-1 text-sm font-semibold text-gray-900">
        Listing copy for each channel
      </h3>
      <p className="mb-4 text-xs text-gray-500">
        Ready-to-paste wording built from this rental&apos;s details, formatted
        for each site - the title length, link placement, and call-to-action are
        adjusted per platform. Pick a channel, copy, and paste it into your ad.
        Edit the rental above and this updates automatically.
      </p>

      {descriptionThin && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <span className="font-medium">Want a stronger listing?</span> The copy
          below is built from your description, and right now it&apos;s mostly
          just the basics. Add a few details about layout, light, special
          features, and what&apos;s nearby and this turns into a real ad.{" "}
          <a
            href="#listing-description"
            className="font-medium text-amber-900 underline hover:no-underline"
          >
            Help me write this -&gt;
          </a>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              t.key === active
                ? "bg-brand text-white"
                : "border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-medium text-gray-500">Title</label>
          <button
            type="button"
            onClick={() => copy(current.title, "title")}
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            {copied === "title" ? "Copied!" : "Copy title"}
          </button>
        </div>
        <input
          readOnly
          value={current.title}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800"
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-medium text-gray-500">
            Description
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => copy(current.body, "body")}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {copied === "body" ? "Copied!" : "Copy description"}
            </button>
            <button
              type="button"
              onClick={() => copy(fullText, "all")}
              className="rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-white"
            >
              {copied === "all" ? "Copied!" : "Copy all"}
            </button>
          </div>
        </div>
        <textarea
          readOnly
          rows={12}
          value={current.body}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full resize-y rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800"
        />
      </div>
    </div>
  );
}

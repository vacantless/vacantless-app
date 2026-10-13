"use client";

import { useState } from "react";
import { MARKETPLACE_CREATE_RENTAL_URL } from "@/lib/marketplace-kit";

// S712: the four Marketplace steps, shared by the landlord's rental page and
// the showing agent's no-login page. Facebook Marketplace has no API, so a
// person posts the ad from their own Facebook; this makes it a few taps:
// copy the ad, save the photos, open Marketplace, paste the ad link back.

export type MarketplaceKitFact = { label: string; value: string };

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        } catch {
          setCopied(false);
        }
      }}
      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-800">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-gray-900">{title}</p>
        <div className="mt-1 space-y-1.5 text-[12.5px] leading-relaxed text-gray-600">{children}</div>
      </div>
    </li>
  );
}

export function MarketplaceKitSteps({
  adText,
  facts,
  photosHref,
  photoCount,
  renterReply,
  saveAction,
  hiddenFields,
  saveError,
}: {
  adText: string;
  facts: MarketplaceKitFact[];
  photosHref: string;
  photoCount: number;
  renterReply: string;
  saveAction: (formData: FormData) => void | Promise<void>;
  hiddenFields: Record<string, string>;
  saveError?: string | null;
}) {
  return (
    <ol className="space-y-4">
      <Step n={1} title="Copy the ad">
        <p>It already has the link renters use to book a viewing.</p>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-2 font-sans text-[12px] text-gray-800">
          {adText}
        </pre>
        <CopyButton text={adText} label="Copy the ad" />
      </Step>

      <Step n={2} title="Save the photos">
        {photoCount > 0 ? (
          <a
            href={photosHref}
            className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700"
          >
            Download {photoCount} photo{photoCount === 1 ? "" : "s"}
          </a>
        ) : (
          <p className="text-amber-700">This rental has no photos yet. Marketplace needs at least one.</p>
        )}
      </Step>

      <Step n={3} title="Post it on Marketplace">
        <p>Open Marketplace on your own Facebook and choose Property for rent.</p>
        <p>Add the photos. Paste the ad into the description. Then fill in these details:</p>
        {facts.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border border-gray-200 bg-white p-2 text-[12px]">
            {facts.map((f) => (
              <div key={f.label} className="contents">
                <dt className="text-gray-500">{f.label}</dt>
                <dd className="font-medium text-gray-900">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <a
          href={MARKETPLACE_CREATE_RENTAL_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700"
        >
          Open Marketplace ↗
        </a>
      </Step>

      <Step n={4} title="Paste the link to your ad">
        <p>Once the ad is up, open it and copy its link. Paste it here.</p>
        <p>Then the rental shows the ad as live.</p>
        <form action={saveAction} className="flex flex-wrap items-center gap-2">
          {Object.entries(hiddenFields).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input
            name="url"
            type="url"
            required
            placeholder="https://www.facebook.com/marketplace/item/..."
            aria-label="Link to your Marketplace ad"
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-[12.5px]"
          />
          <button
            type="submit"
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-700"
          >
            Save
          </button>
        </form>
        {saveError ? <p className="text-red-700">{saveError}</p> : null}
      </Step>

      <Step n={5} title="When renters message you">
        <p>Send them this reply so they book a viewing themselves:</p>
        <pre className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-2 font-sans text-[12px] text-gray-800">
          {renterReply}
        </pre>
        <CopyButton text={renterReply} label="Copy the reply" />
      </Step>
    </ol>
  );
}

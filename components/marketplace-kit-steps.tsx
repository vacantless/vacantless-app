"use client";

import { useEffect, useState } from "react";
import { MARKETPLACE_CREATE_RENTAL_URL, marketplacePhotoFileName } from "@/lib/marketplace-kit";

// S712: the four Marketplace steps, shared by the landlord's rental page and
// the showing agent's no-login page. Facebook Marketplace has no API, so a
// person posts the ad from their own Facebook; this makes it a few taps:
// copy the ad, save the photos, open Marketplace, paste the ad link back.
//
// S736 (review item 9): on a phone, step 2 saves the photos through the
// phone's own share sheet ("Save N images" on iPhone) instead of a zip a phone
// cannot open. Where the share sheet cannot take files, the photos show as a
// grid to press and hold. A computer keeps the zip.

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


type PhoneSave = "checking" | "computer" | "share" | "grid";

// A phone that can share files gets one button; the photos are fetched when the
// step shows, so the tap opens the share sheet straight away (iPhone refuses a
// share that waits on a download after the tap).
function PhotoSaver({ photoUrls, photosHref, photoCount }: { photoUrls: string[]; photosHref: string; photoCount: number }) {
  const [mode, setMode] = useState<PhoneSave>("checking");
  const [files, setFiles] = useState<File[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const urlsKey = photoUrls.join("|");

  useEffect(() => {
    let phone = false;
    try {
      phone = window.matchMedia("(pointer: coarse)").matches;
    } catch {
      phone = false;
    }
    if (!phone || photoUrls.length === 0) {
      setMode("computer");
      return;
    }
    let canShareFiles = false;
    try {
      const probe = new File([new Uint8Array([0])], "probe.jpg", { type: "image/jpeg" });
      canShareFiles = typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] });
    } catch {
      canShareFiles = false;
    }
    if (!canShareFiles) {
      setMode("grid");
      return;
    }
    setMode("share");
    let cancelled = false;
    (async () => {
      try {
        const got = await Promise.all(
          photoUrls.map(async (url, i) => {
            const res = await fetch(url, { cache: "force-cache" });
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            return new File([blob], marketplacePhotoFileName(i, url), { type: blob.type || "image/jpeg" });
          }),
        );
        if (!cancelled) setFiles(got);
      } catch {
        if (!cancelled) setMode("grid");
      }
    })();
    return () => {
      cancelled = true;
    };
    // urlsKey stands for photoUrls: a new array with the same links must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey]);

  const n = photoUrls.length || photoCount;
  const plural = n === 1 ? "" : "s";

  if (mode === "share") {
    return (
      <>
        <button
          type="button"
          disabled={!files}
          onClick={async () => {
            if (!files) return;
            try {
              await navigator.share({ files });
              setNote("Saved. Add them from your photos in step 3.");
            } catch (e) {
              if ((e as { name?: string })?.name !== "AbortError") setMode("grid");
            }
          }}
          className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {files ? `Save ${n} photo${plural} to your phone` : `Getting ${n} photo${plural} ready...`}
        </button>
        <p>Then choose Save images. They go to your phone's photos.</p>
        {note ? <p className="text-emerald-700">{note}</p> : null}
      </>
    );
  }

  if (mode === "grid") {
    return (
      <>
        <p>Press and hold each photo, then choose Save to Photos.</p>
        <div className="grid grid-cols-3 gap-1.5">
          {photoUrls.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={url} src={url} alt={`Photo ${i + 1}`} className="aspect-square w-full rounded-md object-cover" />
          ))}
        </div>
        <a href={photosHref} className="font-semibold text-indigo-700 hover:underline">
          Or download them as one zip file
        </a>
      </>
    );
  }

  return (
    <a
      href={photosHref}
      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700"
    >
      Download {photoCount} photo{photoCount === 1 ? "" : "s"}
    </a>
  );
}

export function MarketplaceKitSteps({
  adText,
  facts,
  photosHref,
  photoCount,
  photoUrls = [],
  renterReply,
  saveAction,
  hiddenFields,
  saveError,
}: {
  adText: string;
  facts: MarketplaceKitFact[];
  photosHref: string;
  photoCount: number;
  /** S736: the photo links a phone saves through its share sheet. */
  photoUrls?: string[];
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
          <PhotoSaver photoUrls={photoUrls} photosHref={photosHref} photoCount={photoCount} />
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
        <p>In the Facebook app, open your ad, tap Share, then Copy link.</p>
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

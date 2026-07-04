"use client";

import { useState } from "react";
import { copyToClipboard } from "@/lib/copy-to-clipboard";

/**
 * "Marketing kit" card (S388, Tier A). The paid promotion PACKAGE for an active
 * rental: the public landing link + a scannable QR + a one-click "copy every
 * channel's wording" blob + a where-to-post checklist. It does NOT generate the
 * copy (the per-channel card below does) and never runs or pays for an ad (that
 * is the later Tier B done-for-you boost). Gated by canUseListingMarketing —
 * an ungated plan sees a locked upsell instead of the payload, so this component
 * renders the upsell state itself (locked) for a consistent surface.
 */
export function MarketingKitCard({
  locked,
  notLive = false,
  notLiveTitle = "This rental isn't live yet.",
  notLiveBody = "Use Publish at the top of the page to get your public link and QR code; the channel wording below is ready to prepare now.",
  landingUrl,
  qrSvg,
  combinedText,
  postChecklist,
  qrFilename,
  feedStatus,
}: {
  // True when the org's plan lacks the listing_marketing entitlement.
  locked: boolean;
  // True when the rental is not bookable (Draft / off market / paused / leased)
  // so the landing link is unavailable; the kit is still previewable but framed
  // as prep/history rather than ready-to-promote.
  notLive?: boolean;
  notLiveTitle?: string;
  notLiveBody?: string;
  landingUrl: string | null;
  // The inline SVG markup for the landing-link QR, or null when unavailable.
  qrSvg: string | null;
  combinedText: string;
  postChecklist: string[];
  qrFilename: string;
  // Aggregator-feed status for this rental (Slice A2), from the same feedSignal
  // the rentals list uses. inFeed = currently syndicating; hint explains the
  // state (e.g. set it Live, or add a photo) when not.
  feedStatus: { inFeed: boolean; hint: string } | null;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const shareableLinkId = "marketing-kit-shareable-link";
  const allWordingId = "marketing-kit-all-wording";

  async function copy(text: string, field: string) {
    const ok = await copyToClipboard(text);
    const key = ok ? field : `${field}:manual`;
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), ok ? 1500 : 2500);
  }

  // Button label for a copy target: "Copied!" on success, "Copy failed" when
  // both clipboard paths were blocked (the selectable field beside it is the
  // manual fallback), otherwise the resting label.
  function copyLabel(field: string, base: string) {
    if (copied === field) return "Copied!";
    if (copied === `${field}:manual`) return "Copy failed";
    return base;
  }

  function downloadQr() {
    if (!qrSvg) return;
    const blob = new Blob([qrSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = qrFilename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Marketing kit</h3>
        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
          Growth
        </span>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        Everything you need to promote this rental yourself: a shareable link, a
        QR code for flyers and signs, and all your channel wording in one copy.
      </p>

      {locked ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
          <p className="mb-2 font-medium text-gray-800">
            The marketing kit is on Growth and Premium.
          </p>
          <p className="mb-3">
            Package your listing into a shareable link, a printable QR code, and
            a one-tap copy of every channel&apos;s wording. Upgrade to turn an
            active rental into a promotion in seconds.
          </p>
          <a
            href="/dashboard/billing"
            className="inline-block rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white"
          >
            See plans -&gt;
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          {notLive && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <span className="font-medium">{notLiveTitle}</span> {notLiveBody}
            </div>
          )}

          {landingUrl && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={shareableLinkId}
                  className="mb-1 block text-xs font-medium text-gray-500"
                >
                  Shareable link
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id={shareableLinkId}
                    readOnly
                    aria-label="Shareable listing link"
                    value={landingUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800"
                  />
                  <button
                    type="button"
                    onClick={() => copy(landingUrl, "link")}
                    className="shrink-0 rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {copyLabel("link", "Copy link")}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-gray-400">
                  Scans and clicks land on your public listing page.
                </p>
              </div>

              {qrSvg && (
                <div className="flex flex-col items-center">
                  <div
                    className="h-[120px] w-[120px] overflow-hidden rounded-lg border border-gray-200 bg-white p-1.5 [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                    // qrSvg is generated server-side by the qrcode package from
                    // the app's own landing URL — not user input — so the markup
                    // is trusted. The child-svg utilities scale the QR (rendered
                    // at a fixed px size by qrcode) to fit this box.
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                  <button
                    type="button"
                    onClick={downloadQr}
                    className="mt-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Download QR
                  </button>
                </div>
              )}
            </div>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label
                htmlFor={allWordingId}
                className="text-xs font-medium text-gray-500"
              >
                All channel wording
              </label>
              <button
                type="button"
                onClick={() => copy(combinedText, "all")}
                className="rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-white"
              >
                {copyLabel("all", "Copy everything")}
              </button>
            </div>
            <textarea
              id={allWordingId}
              readOnly
              aria-label="All channel wording"
              rows={8}
              value={combinedText}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full resize-y rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800"
            />
            <p className="mt-1 text-[11px] text-gray-400">
              Need one channel at a time? Use the per-channel card below.
            </p>
          </div>

          {postChecklist.length > 0 && (
            <div>
              <p className="mb-1.5 block text-xs font-medium text-gray-500">
                Where to post
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {postChecklist.map((label) => (
                  <li
                    key={label}
                    className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-600"
                  >
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {feedStatus && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    feedStatus.inFeed ? "bg-green-500" : "bg-gray-300"
                  }`}
                />
                <span className="text-xs font-medium text-gray-700">
                  {feedStatus.inFeed
                    ? "Syndicating to rental aggregators"
                    : "Not in the aggregator feed yet"}
                </span>
              </div>
              <p className="mt-1 pl-4 text-[11px] text-gray-500">
                {feedStatus.inFeed
                  ? "This rental is included in your listing feed for Rentals.ca, Zumper, and partner sites - no posting needed."
                  : feedStatus.hint}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

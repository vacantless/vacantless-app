"use client";

import { useState } from "react";

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
  landingUrl,
  qrSvg,
  combinedText,
  postChecklist,
  qrFilename,
}: {
  // True when the org's plan lacks the listing_marketing entitlement.
  locked: boolean;
  // True when the rental is not Live (Draft / off market) so the landing link
  // is unavailable; the kit is still previewable but framing softens.
  notLive?: boolean;
  landingUrl: string | null;
  // The inline SVG markup for the landing-link QR, or null when unavailable.
  qrSvg: string | null;
  combinedText: string;
  postChecklist: string[];
  qrFilename: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(text: string, field: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(field);
      setTimeout(() => setCopied((c) => (c === field ? null : c)), 1500);
    } catch {
      // Clipboard may be unavailable; nothing else to do.
    }
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
              <span className="font-medium">This rental isn&apos;t live yet.</span>{" "}
              Set it to Live (above) to get your public link and QR code; the
              channel wording below is ready to prepare now.
            </div>
          )}

          {landingUrl && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Shareable link
                </label>
                <div className="flex items-center gap-2">
                  <input
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
                    {copied === "link" ? "Copied!" : "Copy link"}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-gray-400">
                  Scans and clicks land on your public listing page.
                </p>
              </div>

              {qrSvg && (
                <div className="flex flex-col items-center">
                  <div
                    className="h-[120px] w-[120px] rounded-lg border border-gray-200 bg-white p-1.5"
                    // qrSvg is generated server-side by the qrcode package from
                    // the app's own landing URL — not user input — so the markup
                    // is trusted.
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
              <label className="text-xs font-medium text-gray-500">
                All channel wording
              </label>
              <button
                type="button"
                onClick={() => copy(combinedText, "all")}
                className="rounded-lg bg-brand px-2.5 py-1 text-xs font-medium text-white"
              >
                {copied === "all" ? "Copied!" : "Copy everything"}
              </button>
            </div>
            <textarea
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
              <label className="mb-1.5 block text-xs font-medium text-gray-500">
                Where to post
              </label>
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
        </div>
      )}
    </div>
  );
}

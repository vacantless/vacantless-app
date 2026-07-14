"use client";

// No-install pop-out SIDECAR (Lane C, S484). The client shell for the co-pilot
// companion window opened by "Open co-pilot window" in the co-pilot panel. It is
// the S483 extension's value MINUS the install: the same channel-fit copy with
// Copy buttons + the ordered steps + the paste-the-live-URL completion — but on a
// surface Vacantless controls (a same-origin window), so there is NO bridge, NO
// nonce, NO content script. Completion posts to the EXISTING completeCopilotPost
// action, which re-validates the URL and enforces the proof-gate server-side.
//
// The operator copies each field into the portal, posts it themselves, pastes the
// live ad URL, and marks it live. Vacantless never posts, never submits, never
// stores a login — identical honesty to the in-app panel and the extension.

import { useState } from "react";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { completeCopilotPost } from "../../../distribution-actions";
import { stopGateLabel, type CopilotScript } from "@/lib/distribution-copilot";

const FIELD_CLASS =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";

function CopyField({
  label,
  value,
  multiline,
  hint,
}: {
  label: string;
  value: string;
  multiline: boolean;
  hint?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {label}
        </span>
        <button
          type="button"
          onClick={copy}
          className="rounded-md bg-brand px-2.5 py-1 text-[11px] font-medium text-white"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      {multiline ? (
        <textarea
          readOnly
          value={value}
          rows={6}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full resize-y rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700"
        />
      ) : (
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700"
        />
      )}
      {hint && <p className="mt-1 text-[11px] text-gray-500">{hint}</p>}
    </div>
  );
}

export function SidecarCopilot({
  propertyId,
  itemId,
  channelLabel,
  script,
}: {
  propertyId: string;
  itemId: string;
  channelLabel: string;
  script: CopilotScript;
}) {
  return (
    <div className="mx-auto w-full max-w-lg space-y-3">
      <header className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">
          Guided posting — no install needed
        </p>
        <h1 className="text-lg font-semibold text-gray-900">
          Post to {channelLabel}
        </h1>
        <p className="text-xs text-gray-500">
          Copy each field into {channelLabel}, post it yourself, then paste the
          live ad URL below and mark it live. Vacantless never posts or submits
          for you.
        </p>
      </header>

      {/* Honesty: what Vacantless does and does not do. */}
      <ul className="space-y-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-600">
        {script.honesty.map((h) => (
          <li key={h} className="flex gap-1.5">
            <span aria-hidden className="text-gray-400">
              •
            </span>
            <span>{h}</span>
          </li>
        ))}
      </ul>

      {script.blockers.length > 0 && (
        <ul className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {script.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}

      {script.portalUrl && (
        <a
          href={script.portalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Open {channelLabel} in a new tab
        </a>
      )}

      {/* Copyable, channel-fit content. */}
      {script.fields.length > 0 && (
        <div className="grid gap-2">
          {script.fields.map((f) => (
            <CopyField
              key={f.key}
              label={f.label}
              value={f.value}
              multiline={f.multiline}
              hint={f.hint}
            />
          ))}
        </div>
      )}

      {/* Ordered steps; stop-gate steps are called out as "you do this". */}
      <ol className="space-y-1.5">
        {script.steps.map((step, i) => (
          <li
            key={step.key}
            className={`rounded-lg px-3 py-2 text-xs ${
              step.stopGate
                ? "border border-amber-200 bg-amber-50 text-amber-900"
                : "text-gray-600"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-gray-400">{i + 1}.</span>
              <span className="font-medium text-gray-800">{step.label}</span>
              {step.stopGate && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                  {stopGateLabel(step.stopGate)} — Vacantless stops here
                </span>
              )}
            </div>
            {step.detail && (
              <p className="mt-0.5 pl-5 text-gray-500">{step.detail}</p>
            )}
          </li>
        ))}
      </ol>

      {/* Completion: paste the live URL as proof. Never live without it. Posts to
          the SAME completeCopilotPost as the in-app panel and the extension. */}
      <form
        action={completeCopilotPost}
        className="space-y-2 rounded-lg border border-gray-200 bg-white p-3"
      >
        <input type="hidden" name="item_id" value={itemId} />
        <input type="hidden" name="property_id" value={propertyId} />
        <div>
          <label className="mb-1 block text-[11px] font-medium text-gray-500">
            Live ad URL (required — proof it is posted)
          </label>
          <input
            name="external_url"
            required
            placeholder="https://..."
            className={FIELD_CLASS}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="min-w-[10rem] flex-1">
            <label className="mb-1 block text-[11px] font-medium text-gray-500">
              Screenshot path (optional)
            </label>
            <input
              name="screenshot_path"
              placeholder="e.g. proof/kijiji-2026-07-13.png"
              className={FIELD_CLASS}
            />
          </div>
          <div className="min-w-[10rem] flex-1">
            <label className="mb-1 block text-[11px] font-medium text-gray-500">
              Note (optional)
            </label>
            <input
              name="note"
              placeholder="e.g. posted; boosted for 7 days"
              className={FIELD_CLASS}
            />
          </div>
        </div>
        <button
          type="submit"
          className="rounded-lg px-4 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: "var(--brand-color)" }}
        >
          I posted it — mark live with this URL
        </button>
        <p className="text-[11px] text-gray-500">
          Records durable proof + turns on the tracked inquiry link. Vacantless
          never marks a channel live without a real ad URL. You can close this
          window when you are done.
        </p>
      </form>
    </div>
  );
}

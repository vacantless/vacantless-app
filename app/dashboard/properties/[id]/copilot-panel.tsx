"use client";

// Browser co-pilot panel (S482). Client component rendered inside a run item for
// the honest browser_copilot channels (Facebook / Kijiji / Viewit). Vacantless
// prepares channel-fit copy + the tracked link and guides each step, but STOPS at
// every human gate (login, payment, CAPTCHA, final review). The operator posts,
// then pastes the live ad URL as proof — completeCopilotPost refuses to mark a
// channel live without it. The pure script comes from lib/distribution-copilot.

import { useState } from "react";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { completeCopilotPost } from "../distribution-actions";
import {
  stopGateLabel,
  type CopilotScript,
} from "@/lib/distribution-copilot";

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

export function CopilotPanel({
  propertyId,
  itemId,
  script,
}: {
  propertyId: string;
  itemId: string;
  script: CopilotScript;
}) {
  return (
    <details className="mb-3 rounded-xl border border-brand/30 bg-brand/5 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-brand">
        Guided posting (co-pilot) — {script.channelLabel}
      </summary>

      <div className="mt-3 space-y-3">
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
            Open {script.channelLabel} in a new tab
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

        {/* Completion: paste the live URL as proof. Never live without it. */}
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
            never marks a channel live without a real ad URL.
          </p>
        </form>
      </div>
    </details>
  );
}

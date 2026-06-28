"use client";

import { Fragment, useMemo, useState } from "react";
import type {
  FillSheet,
  FillField,
  FillFieldSource,
} from "@/lib/listing-fill-sheet";

/**
 * "Fill sheet" card (S262, syndication step 2 — the operator-assist fill, code
 * half). For the chosen portal it lays out that portal's form fields IN ORDER,
 * each with the value already resolved from this rental and the matching gotcha
 * attached, plus a per-field copy button. It's the structured payload a future
 * fill assistant consumes — but here it's still a reference: nothing is
 * submitted, the operator pastes each value in by hand.
 *
 * Purely presentational + clipboard. All the field/value/guardrail logic lives
 * in the tested lib/listing-fill-sheet; the sheets are built server-side and
 * passed in, so this component never re-derives anything.
 */

const SOURCE_BADGE: Record<
  FillFieldSource,
  { label: string; cls: string } | null
> = {
  // A plain copy-paste field needs no badge — the value speaks for itself.
  listing: null,
  preset: { label: "Recommended", cls: "bg-indigo-50 text-indigo-700" },
  manual: { label: "You enter this", cls: "bg-amber-50 text-amber-700" },
};

export function FillSheetCard({ sheets }: { sheets: FillSheet[] }) {
  const [portal, setPortal] = useState(sheets[0]?.portal ?? "kijiji");
  const [copied, setCopied] = useState<string | null>(null);

  const sheet = useMemo(
    () => sheets.find((s) => s.portal === portal) ?? sheets[0],
    [sheets, portal],
  );

  // Resolve a field's guardrailId to its detail for the inline "why" line.
  const guardrailById = useMemo(() => {
    const m = new Map<string, { title: string; detail: string }>();
    for (const g of sheet?.guardrails ?? []) {
      m.set(g.id, { title: g.title, detail: g.detail });
    }
    return m;
  }, [sheet]);

  if (!sheet) return null;

  const prefilled = sheet.fields.filter(
    (f) => f.source === "listing" && f.value != null,
  ).length;
  const fromListing = sheet.fields.filter((f) => f.source === "listing").length;

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch {
      // Clipboard blocked — the value box is selectable as a manual fallback.
    }
  }

  return (
    <details className="mb-4 rounded-xl border border-gray-200 bg-gray-50/60">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm font-medium text-gray-900">
        <span>Fill sheet — field-by-field for each portal</span>
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
          {prefilled}/{fromListing} pre-filled
        </span>
      </summary>

      <div className="border-t border-gray-200 px-4 pb-4 pt-3">
        <div className="mb-3 w-56">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Which portal are you filling out?
          </label>
          <select
            value={sheet.portal}
            onChange={(e) => {
              setPortal(e.target.value as FillSheet["portal"]);
              setCopied(null);
            }}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            {sheets.map((s) => (
              <option key={s.portal} value={s.portal}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {sheet.fields.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-500">
            No self-serve form for {sheet.label}. See the &ldquo;Before you
            post&rdquo; checklist for how this portal is handled.
          </p>
        ) : (
          <ol className="space-y-2">
            {sheet.fields.map((f, i) => {
              // On stepped portals (Rentals.ca) show a step header whenever the
              // step changes; flat for single-page portals (step undefined).
              const showStep = !!f.step && f.step !== sheet.fields[i - 1]?.step;
              return (
                <Fragment key={f.id}>
                  {showStep && (
                    <li className="list-none px-1 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-500 first:pt-0">
                      {f.step}
                    </li>
                  )}
                  <FillRow
                    field={f}
                    copied={copied === f.id}
                    onCopy={() => f.value != null && copy(f.value, f.id)}
                    why={
                      f.guardrailId ? guardrailById.get(f.guardrailId) : undefined
                    }
                  />
                </Fragment>
              );
            })}
          </ol>
        )}

        <p className="mt-3 text-xs text-gray-400">
          A reference you copy from — you paste each value into the rental site
          yourself. Nothing here is submitted for you. Edit the rental above and
          this updates automatically.
        </p>
      </div>
    </details>
  );
}

function FillRow({
  field,
  copied,
  onCopy,
  why,
}: {
  field: FillField;
  copied: boolean;
  onCopy: () => void;
  why?: { title: string; detail: string };
}) {
  const badge = SOURCE_BADGE[field.source];
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-900">{field.label}</span>
        {badge && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}
          >
            {badge.label}
          </span>
        )}
      </div>

      {field.value != null ? (
        <div className="mt-2 flex items-start gap-2">
          <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 font-sans text-sm text-gray-800">
            {field.value}
          </pre>
          <button
            type="button"
            onClick={onCopy}
            className="flex-shrink-0 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      ) : (
        <p className="mt-2 rounded-md border border-dashed border-amber-200 bg-amber-50/50 px-2 py-1.5 text-xs text-amber-700">
          {field.source === "manual"
            ? "Enter this one yourself."
            : "Not set on this rental yet — add it above to pre-fill here."}
        </p>
      )}

      {field.hint && (
        <p className="mt-1.5 text-xs text-gray-500">{field.hint}</p>
      )}

      {why && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
            Why this matters
          </summary>
          <p className="mt-1 text-xs text-gray-500">{why.detail}</p>
        </details>
      )}
    </li>
  );
}

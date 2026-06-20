"use client";

import { useMemo, useState } from "react";
import { PORTALS, type PortalKey } from "@/lib/listing-distribution";
import {
  guardrailsForPortal,
  countBySeverity,
  severityLabel,
  type GuardrailSeverity,
} from "@/lib/listing-guardrails";

// "Before you post" — the per-portal gotcha checklist (S260). Pure content: it
// warns the operator about the documented traps for the portal they're about to
// post on by hand, so it carries none of the ToS / automation risk a fill would.
// No server action, no network — just a portal picker + a local checked-off list
// to work down before paying / publishing.

const SEVERITY_PILL: Record<GuardrailSeverity, string> = {
  critical: "bg-red-50 text-red-700",
  warning: "bg-amber-50 text-amber-700",
  tip: "bg-gray-100 text-gray-600",
};

const SEVERITY_DOT: Record<GuardrailSeverity, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  tip: "bg-gray-400",
};

export function BeforeYouPost({
  defaultPortal = "kijiji",
}: {
  defaultPortal?: PortalKey;
}) {
  const [portal, setPortal] = useState<PortalKey>(defaultPortal);
  // Checked state is keyed by guardrail id, reset when the portal changes.
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const guardrails = useMemo(() => guardrailsForPortal(portal), [portal]);
  const criticalCount = useMemo(
    () => countBySeverity(guardrails, "critical"),
    [guardrails],
  );
  const doneCount = useMemo(
    () => guardrails.filter((g) => checked[g.id]).length,
    [guardrails, checked],
  );

  function onPortalChange(next: PortalKey) {
    setPortal(next);
    setChecked({});
  }

  return (
    <details className="mb-4 rounded-xl border border-gray-200 bg-gray-50/60">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm font-medium text-gray-900">
        <span>Before you post — portal gotchas</span>
        {criticalCount > 0 && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
            {criticalCount} critical {criticalCount === 1 ? "check" : "checks"}
          </span>
        )}
      </summary>

      <div className="border-t border-gray-200 px-4 pb-4 pt-3">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="w-52">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Which portal are you posting on?
            </label>
            <select
              value={portal}
              onChange={(e) => onPortalChange(e.target.value as PortalKey)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              {PORTALS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-gray-500">
            {doneCount} / {guardrails.length} checked
          </p>
        </div>

        <ul className="space-y-2">
          {guardrails.map((g) => {
            const isChecked = !!checked[g.id];
            return (
              <li
                key={g.id}
                className="rounded-lg border border-gray-200 bg-white p-3"
              >
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) =>
                      setChecked((prev) => ({
                        ...prev,
                        [g.id]: e.target.checked,
                      }))
                    }
                    className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_PILL[g.severity]}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[g.severity]}`}
                        />
                        {severityLabel(g.severity)}
                      </span>
                      <span
                        className={`text-sm font-medium ${
                          isChecked
                            ? "text-gray-400 line-through"
                            : "text-gray-900"
                        }`}
                      >
                        {g.title}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-gray-500">
                      {g.detail}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-xs text-gray-400">
          A reference, not automation — you still post by hand. These are the
          traps we&apos;ve hit on each portal so you don&apos;t pay for them
          twice.
        </p>
      </div>
    </details>
  );
}

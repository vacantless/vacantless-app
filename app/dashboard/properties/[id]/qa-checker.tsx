"use client";

// Post-publish QA checker (S412 Slice 6). The operator pastes their live ad's
// text; this runs the pure checker (lib/post-publish-qa) in the browser and
// shows what's right / wrong / worth a second look. No server round-trip, no
// persistence, no scraping — it only reads what the operator pasted.

import { useState } from "react";
import {
  checkPastedAd,
  qaSummary,
  type QaExpected,
  type QaSeverity,
} from "@/lib/post-publish-qa";

const SEVERITY_MARK: Record<QaSeverity, { pass: string; fail: string; failClass: string }> = {
  critical: { pass: "✓", fail: "✕", failClass: "text-red-600" },
  warning: { pass: "✓", fail: "!", failClass: "text-amber-600" },
  tip: { pass: "•", fail: "•", failClass: "text-gray-400" },
};

export function QaChecker({
  channelKey,
  expected,
}: {
  channelKey: string;
  expected: QaExpected;
}) {
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const checks = trimmed
    ? checkPastedAd({ pastedText: text, channelKey, expected })
    : [];
  const summary = trimmed ? qaSummary(checks) : null;

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs font-medium text-brand">
        Check your posted ad
      </summary>
      <div className="mt-2">
        <p className="mb-2 text-xs text-gray-500">
          Paste your live ad&apos;s title and description here and we&apos;ll
          check it against this listing. Nothing is saved or sent anywhere.
        </p>
        <textarea
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the ad text you posted..."
          className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
        />
        {summary && (
          <div className="mt-2">
            <p
              className={`mb-2 text-xs font-medium ${
                summary.allClear ? "text-green-700" : "text-amber-700"
              }`}
            >
              {summary.allClear
                ? "Looks good - no problems found."
                : `${summary.criticalFailures} to fix, ${summary.warnings} to check.`}
            </p>
            <ul className="space-y-1.5">
              {checks.map((c) => {
                const mark = SEVERITY_MARK[c.severity];
                return (
                  <li key={c.key} className="flex items-start gap-2 text-xs">
                    <span
                      aria-hidden
                      className={`mt-px font-semibold ${
                        c.ok ? "text-green-600" : mark.failClass
                      }`}
                    >
                      {c.ok ? mark.pass : mark.fail}
                    </span>
                    <span>
                      <span
                        className={
                          c.ok ? "text-gray-600" : "font-medium text-gray-900"
                        }
                      >
                        {c.label}
                      </span>
                      {(!c.ok || c.severity === "tip") && (
                        <span className="mt-0.5 block text-gray-500">
                          {c.detail}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  isHelperPong,
  MARKETPLACE_HELPER_APP_SOURCE,
} from "@/lib/marketplace-helper";
import { buildSitesSetup, type SitesSetupInput } from "@/lib/sites-setup";

// S760: the five site rows. The helper lives only in this browser, so the row
// for Marketplace asks it (the same ping the dashboard sync uses) and reads
// "On" only when it answers. Everything else is the server's tile state.

const STATE_CHIP: Record<string, { label: string; cls: string }> = {
  on: { label: "On", cls: "bg-green-50 text-green-700" },
  needs_you: { label: "Needs you", cls: "bg-amber-50 text-amber-800" },
  checking: { label: "Checking", cls: "bg-sky-50 text-sky-700" },
  with_posting: { label: "With Posting", cls: "bg-gray-100 text-gray-600" },
};

export function SitesRows({
  input,
  signinAllHref,
}: {
  input: Omit<SitesSetupInput, "helperInstalled" | "hiddenFor">;
  signinAllHref: string | null;
}) {
  const [helperInstalled, setHelperInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    // A phone has no Chrome extension: say so instead of waiting for a pong.
    const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)")?.matches;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (isHelperPong(event.data)) setHelperInstalled(true);
    };
    window.addEventListener("message", onMessage);
    const ping = () => window.postMessage({ source: MARKETPLACE_HELPER_APP_SOURCE, type: "ping" }, window.location.origin);
    const timers = [0, 800, 2500].map((ms) => window.setTimeout(ping, ms));
    const settle = window.setTimeout(() => setHelperInstalled((v) => (v === null ? (coarse ? null : false) : v)), 3200);
    return () => {
      window.removeEventListener("message", onMessage);
      timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(settle);
    };
  }, []);

  const setup = useMemo(() => buildSitesSetup({ ...input, helperInstalled }), [input, helperInstalled]);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-gray-600">{setup.summary}</p>
        <p className="text-sm font-semibold text-gray-900">{setup.progress}</p>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-2 rounded-full bg-brand transition-all"
          style={{ width: `${setup.total ? Math.round((setup.connectedCount / setup.total) * 100) : 0}%` }}
        />
      </div>

      {signinAllHref && setup.nextSignin ? (
        <a
          href={signinAllHref}
          className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white shadow-sm"
        >
          Sign in to Kijiji, Rentals.ca and Zumper, one after the other
        </a>
      ) : null}

      <ul className="mt-4 space-y-3">
        {setup.rows.map((row) => {
          const chip = STATE_CHIP[row.state];
          return (
            <li key={row.key} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-gray-900">{row.label}</span>
                <span className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-bold ${chip.cls}`}>{chip.label}</span>
              </div>
              <p className="mt-1 text-sm text-gray-600">{row.line}</p>
              {row.action ? (
                <a
                  href={row.action.href}
                  target={row.action.external ? "_blank" : undefined}
                  rel={row.action.external ? "noopener noreferrer" : undefined}
                  className={`mt-3 inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium ${
                    row.state === "with_posting"
                      ? "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      : "bg-brand text-white"
                  }`}
                >
                  {row.action.label}
                  {row.action.external ? " ↗" : " →"}
                </a>
              ) : null}
              {row.note ? <p className="mt-2 text-xs text-gray-500">{row.note}</p> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

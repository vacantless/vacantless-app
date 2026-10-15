"use client";

import { useEffect, useState, useTransition } from "react";
import {
  siteSigninIsOpen,
  siteSigninPassword,
  siteSigninSafeViewUrl,
  siteSigninView,
  type SiteSigninChannel,
} from "@/lib/site-signin";
import {
  cancelSiteSignin,
  confirmSiteSignin,
  readSiteSigninWindow,
  type SiteSigninWindowRead,
} from "./actions";

const TONE: Record<string, string> = {
  wait: "border-gray-200 bg-white",
  action: "border-brand/30 bg-brand/[0.03]",
  ok: "border-green-200 bg-green-50",
  bad: "border-amber-200 bg-amber-50",
};

export function WindowPanel({
  channel,
  initial,
}: {
  channel: SiteSigninChannel;
  initial: NonNullable<SiteSigninWindowRead>;
}) {
  const [win, setWin] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    if (!siteSigninIsOpen(win.status)) return;
    const timer = setInterval(async () => {
      const next = await readSiteSigninWindow(win.id);
      if (next) {
        setWin(next);
        if (next.detail === "not_signed_in_yet" || next.detail === "enter_code") setAsked(false);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [win.id, win.status]);

  const view = siteSigninView(channel, win.status, win.detail);
  const link = siteSigninSafeViewUrl(win.viewUrl);
  const password = siteSigninPassword(win.viewUrl);

  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${TONE[view.tone]}`}>
      <h2 className="text-base font-semibold text-gray-900">{view.title}</h2>
      <p className="mt-1 max-w-xl text-sm text-gray-600">{view.body}</p>

      {win.status === "starting" && (
        <div className="mt-4 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-gray-100">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-brand" />
        </div>
      )}

      {win.status === "ready" && link && (
        <div className="mt-4 space-y-3">
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm"
          >
            Open the sign-in window
          </a>
          {win.expiresAt && (
            <p className="text-xs text-gray-500">
              The window stays open until{" "}
              {new Date(win.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
            </p>
          )}
          {password && (
            <p className="text-xs text-gray-500">
              If the window asks for a password, it is <span className="font-mono font-semibold text-gray-800">{password}</span>. It works only for this window.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={pending || asked}
              onClick={() =>
                startTransition(async () => {
                  setAsked(true);
                  await confirmSiteSignin(win.id);
                })
              }
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60"
            >
              {asked ? "Checking..." : "I'm signed in"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await cancelSiteSignin(win.id);
                  setWin({ ...win, status: "cancelled", viewUrl: null });
                })
              }
              className="text-sm text-gray-500 underline"
            >
              Stop
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

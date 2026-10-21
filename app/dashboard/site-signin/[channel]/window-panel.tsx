"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  failStalledSiteSignin,
  readSiteSigninWindow,
  type SiteSigninWindowRead,
} from "./actions";

/** S728: how long "starting" may last before the page gives up on it. */
const STARTING_LIMIT_MS = 3 * 60_000;

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
  const router = useRouter();
  // S724 (V251-23): when an open window ends (closed after 10 minutes, stopped,
  // failed or done) re-render the page, so "Try again" shows without a reload.
  const wasOpen = useRef(siteSigninIsOpen(initial.status));
  useEffect(() => {
    if (wasOpen.current && !siteSigninIsOpen(win.status)) {
      wasOpen.current = false;
      router.refresh();
    }
  }, [win.status, router]);

  // S728: a window stuck at "starting" is given up on after three minutes,
  // so the landlord sees "The window did not open" and a Try again, not a
  // spinner that never ends (the runner may be asleep).
  const startingSince = useRef(Date.now());
  useEffect(() => {
    if (!siteSigninIsOpen(win.status)) return;
    const timer = setInterval(async () => {
      if (win.status === "starting" && Date.now() - startingSince.current > STARTING_LIMIT_MS) {
        await failStalledSiteSignin(win.id);
      }
      const next = await readSiteSigninWindow(win.id);
      if (next) {
        setWin(next);
        if (next.detail === "not_signed_in_yet" || next.detail === "enter_code") setAsked(false);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [win.id, win.status]);

  // S724 (V251-20): show the minutes left, so the window never closes by surprise.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!siteSigninIsOpen(win.status) || !win.expiresAt) return;
    const t = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(t);
  }, [win.status, win.expiresAt]);
  const minutesLeft = win.expiresAt
    ? Math.max(0, Math.ceil((Date.parse(win.expiresAt) - nowMs) / 60000))
    : null;

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
              {minutesLeft != null ? ` ${minutesLeft === 1 ? "1 minute" : `${minutesLeft} minutes`} left.` : ""}
            </p>
          )}
          <p className="text-xs text-gray-500">
            We run this window for you. Its web address looks unusual because it is made just for this sign-in. That is expected.
          </p>
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

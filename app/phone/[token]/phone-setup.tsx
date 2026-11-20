"use client";
import { useState } from "react";
import { CopyTextButton } from "@/components/copy-text-button";
import { copyWhenReady } from "@/lib/copy-then-open";
import { setUpThisPhone } from "./actions";

// S824d: one tap. iPhone: sign in, make the key, copy it, open the Shortcut.
// Android: sign in, then the install steps on Quick replies.
export function PhoneSetup({
  token,
  kind,
  shortcutUrl,
  stateLine,
}: {
  token: string;
  kind: "iphone" | "android" | "other";
  shortcutUrl: string;
  /** S825a: set when the code is used up or expired. Kept in the same place
   * in the page so the "key copied" panel survives the refresh that the
   * phone's sign-in causes. */
  stateLine: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<{ key: string; copied: boolean } | null>(null);
  const isFile = shortcutUrl.endsWith(".shortcut");

  async function iphone() {
    setBusy(true);
    setMessage(null);
    const p = setUpThisPhone(token, "iphone");
    const copied = await copyWhenReady(p.then((r) => (r.ok && r.key ? r.key : null)));
    const r = await p;
    setBusy(false);
    if (!r.ok || !r.key) {
      setMessage(r.message ?? "Something went wrong. Try again in a minute.");
      return;
    }
    setDone({ key: r.key, copied });
    // S825a: let the sign-in's page refresh finish first. Leaving mid-load
    // made iPhone Safari show the crash page ("Load failed").
    window.setTimeout(() => {
      window.location.href = shortcutUrl;
    }, 800);
  }

  async function android() {
    setBusy(true);
    setMessage(null);
    const r = await setUpThisPhone(token, "android");
    setBusy(false);
    if (!r.ok) {
      setMessage(r.message ?? "Something went wrong. Try again in a minute.");
      return;
    }
    window.setTimeout(() => {
      window.location.href = "/dashboard/replies#android-share";
    }, 800);
  }

  if (done) {
    return (
      <div className="mt-4 space-y-4 text-sm">
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
          {done.copied ? "Your key is copied." : "Copy your key first."} When asked for the key, tap the box, then Paste.
          Then tap Add Shortcut.
        </p>
        {!done.copied ? (
          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="break-all font-mono text-xs">{done.key}</p>
            <div className="mt-2">
              <CopyTextButton value={done.key} label="Copy key" />
            </div>
          </div>
        ) : null}
        <p>
          To open it again, tap{" "}
          <a href={shortcutUrl} className="font-medium text-brand underline">
            Get the Shortcut
          </a>
          .{isFile ? " If Safari asks, tap Download. Then tap the blue arrow at the top and open it." : ""}
        </p>
        <p className="text-gray-600">
          To use it, screenshot a renter&apos;s chat and tap the picture. Tap Share, then Send to
          Vacantless. It saves the renter and copies your reply.
        </p>
        <a href="/dashboard/replies" className="inline-block text-sm font-medium text-brand underline">
          Open Quick replies on this phone
        </a>
      </div>
    );
  }

  if (stateLine) {
    return (
      <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{stateLine}</p>
    );
  }

  const iphoneButton = (
    <button
      type="button"
      onClick={iphone}
      disabled={busy}
      className="w-full rounded-xl bg-brand px-4 py-3 text-base font-medium text-white disabled:opacity-60"
    >
      {busy ? "Setting up..." : "Add Send to Vacantless"}
    </button>
  );
  const androidButton = (
    <button
      type="button"
      onClick={android}
      disabled={busy}
      className="w-full rounded-xl bg-brand px-4 py-3 text-base font-medium text-white disabled:opacity-60"
    >
      {busy ? "Signing in..." : "Sign in on this phone"}
    </button>
  );

  return (
    <div className="mt-4 space-y-4 text-sm">
      {kind === "android" ? (
        <>
          <p>One tap signs this phone in. Then add Vacantless to your home screen. It then shows up when you share a screenshot.</p>
          {androidButton}
        </>
      ) : kind === "iphone" ? (
        <>
          <p>
            One tap signs this phone in, copies your key and opens the Shortcut. Then tap Paste and Add Shortcut. After
            that, share a renter&apos;s chat screenshot to Send to Vacantless.
          </p>
          {iphoneButton}
        </>
      ) : (
        <>
          <p>Open this page on your phone. Pick the one you have.</p>
          <p className="font-medium text-gray-900">iPhone</p>
          {iphoneButton}
          <p className="font-medium text-gray-900">Android</p>
          {androidButton}
        </>
      )}
      {message ? <p className="text-amber-900">{message}</p> : null}
      <p className="text-xs text-gray-500">This code works once, for 15 minutes.</p>
    </div>
  );
}

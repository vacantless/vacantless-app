"use client";

import { useState } from "react";
import { CopyTextButton } from "@/components/copy-text-button";
import { SEND_SHORTCUT_STEPS, SEND_URL_PATH } from "@/lib/send-shortcut-copy";
import { makeSendToVacantlessKey, turnOffSendToVacantlessKey } from "./actions";

// S816l: "Send to Vacantless" in the iPhone share menu. Make a key, put it in
// the Apple Shortcut once, then share any chat screenshot to save the renter.
export function SendShortcutCard({
  appUrl,
  hint,
  lastUsed,
  shortcutUrl,
}: {
  appUrl: string;
  hint: string | null;
  lastUsed: string | null;
  shortcutUrl: string | null;
}) {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(Boolean(hint));
  const sendUrl = `${appUrl}${SEND_URL_PATH}`;

  async function make() {
    setBusy(true);
    setMessage(null);
    const r = await makeSendToVacantlessKey();
    setBusy(false);
    if (r.ok && r.key) {
      setKey(r.key);
      setHasKey(true);
    } else setMessage(r.message ?? "We could not make a key. Try again.");
  }

  async function turnOff() {
    setBusy(true);
    await turnOffSendToVacantlessKey();
    setBusy(false);
    setKey(null);
    setHasKey(false);
    setMessage("Your key is off. The Shortcut stops working until you make a new key.");
  }

  return (
    <details id="send-shortcut" className="mt-6 scroll-mt-4 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700" open={Boolean(key) || !hasKey}>
      <summary className="cursor-pointer font-medium text-gray-900">Save the renter and copy your reply from a chat screenshot</summary>
      <p className="mt-2">
        Take a screenshot of the chat, tap Share, then &quot;Send to Vacantless&quot;. We read the renter&apos;s name and the rental. Then we
        save them in Renters. We also copy your Quick replies answer, so paste it in the chat. Works for Messenger, Kijiji, texts and
        email.
      </p>

      {key ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="font-medium text-gray-900">Your key</p>
          <p className="mt-1 break-all font-mono text-xs">{key}</p>
          <div className="mt-2">
            <CopyTextButton value={key} label="Copy key" />
          </div>
          <p className="mt-2 text-xs text-gray-600">We show it only this once. If you lose it, make a new one.</p>
        </div>
      ) : hasKey ? (
        <p className="mt-3 text-xs text-gray-600">
          Your key ends in {hint}.{lastUsed ? ` Last used ${lastUsed}.` : " Not used yet."}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={make}
          disabled={busy}
          className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {hasKey ? "Make a new key" : "Make my key"}
        </button>
        {hasKey ? (
          <button type="button" onClick={turnOff} disabled={busy} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            Turn off my key
          </button>
        ) : null}
      </div>
      {message ? <p className="mt-2 text-xs text-gray-700">{message}</p> : null}

      {shortcutUrl ? (
        <div className="mt-4">
          <p className="font-medium text-gray-900">Add the Shortcut</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            <li>Open this page on your iPhone. Make your key above and copy it.</li>
            <li>
              Tap{" "}
              <a href={shortcutUrl} className="text-brand underline">
                Get the Shortcut
              </a>
              . If Safari asks, tap Download, then open it from Downloads.
            </li>
            <li>Tap &quot;Add Shortcut&quot;. When it asks for your key, paste it.</li>
          </ol>
        </div>
      ) : (
        <div className="mt-4">
          <p className="font-medium text-gray-900">Make the Shortcut once. It takes about 3 minutes.</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {SEND_SHORTCUT_STEPS.map((s, i) => (
              <li key={i}>{s.replace("{URL}", sendUrl)}</li>
            ))}
          </ol>
          <div className="mt-2">
            <CopyTextButton value={sendUrl} label="Copy the web address" />
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-gray-600">To use it, screenshot the chat and tap the picture in the corner. Tap Share, then Send to Vacantless.</p>
    </details>
  );
}

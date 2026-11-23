"use client";

import { useEffect, useState } from "react";
import { INSTALL_BUTTON_LABEL, INSTALLED_LINE, installState } from "@/lib/share-target";

// S833b: one tap to install Vacantless on an Android phone. Chrome only offers
// this through beforeinstallprompt; on iPhone and computers nothing shows.
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function InstallAppButton() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [android, setAndroid] = useState(false);

  useEffect(() => {
    setAndroid(/Android/i.test(navigator.userAgent));
    try {
      setStandalone(window.matchMedia("(display-mode: standalone)").matches);
    } catch {
      setStandalone(false);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setPromptEvent(null);
      setStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const state = installState({ android, standalone, promptReady: promptEvent != null });
  if (state === "none") return null;
  if (state === "installed") {
    return <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{INSTALLED_LINE}</p>;
  }
  return (
    <button
      type="button"
      onClick={async () => {
        const e = promptEvent;
        if (!e) return;
        await e.prompt();
        try {
          const choice = await e.userChoice;
          if (choice.outcome === "accepted") setStandalone(true);
        } catch {
          // Chrome closed the prompt; the button stays for another try.
        }
        setPromptEvent(null);
      }}
      className="mt-2 w-full rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white"
    >
      {INSTALL_BUTTON_LABEL}
    </button>
  );
}

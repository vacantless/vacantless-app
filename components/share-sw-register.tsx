"use client";

import { useEffect } from "react";

// S833d: registers public/share-sw.js on Android phones only, so a big shared
// picture is shrunk on the phone before it is sent (see that file).
export function ShareSwRegister() {
  useEffect(() => {
    try {
      if (!/Android/i.test(navigator.userAgent) || !("serviceWorker" in navigator)) return;
      navigator.serviceWorker.register("/share-sw.js").catch(() => {});
    } catch {
      // Never let this break a page.
    }
  }, []);
  return null;
}

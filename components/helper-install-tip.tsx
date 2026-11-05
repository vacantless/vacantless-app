"use client";

import { useEffect, useState } from "react";
import {
  isHelperPong,
  MARKETPLACE_HELPER_APP_SOURCE,
  MARKETPLACE_HELPER_INSTALL_URL,
} from "@/lib/marketplace-helper";

// S751: tell a new landlord about the Vacantless helper (the Chrome extension
// that fills the Facebook Marketplace form). Optional and not counted as a
// setup step: whether it is installed is only known in this browser, so the
// tip asks the helper itself (the same ping the dashboard sync uses) and says
// "installed" only when the helper answers.

export function HelperInstallTip() {
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (isHelperPong(event.data)) setInstalled(true);
    };
    window.addEventListener("message", onMessage);
    const ping = () => window.postMessage({ source: MARKETPLACE_HELPER_APP_SOURCE, type: "ping" }, window.location.origin);
    const timers = [0, 800, 2500].map((ms) => window.setTimeout(ping, ms));
    return () => {
      window.removeEventListener("message", onMessage);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  return (
    <section
      aria-labelledby="helper-tip-title"
      className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
    >
      <h2 id="helper-tip-title" className="font-semibold text-gray-900">
        Optional: the Vacantless helper for Facebook Marketplace
      </h2>
      {installed ? (
        <p className="mt-1 text-sm leading-relaxed text-gray-600">
          The helper is installed in this browser. On a rental&apos;s Marketplace row, it fills the Marketplace form for
          you, photos included.
        </p>
      ) : (
        <p className="mt-1 text-sm leading-relaxed text-gray-600">
          Facebook lets only you post a rental on Marketplace, from your own profile. On a computer,{" "}
          <a
            href={MARKETPLACE_HELPER_INSTALL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-brand hover:underline"
          >
            add the free Vacantless helper to Chrome
          </a>{" "}
          and it fills the Marketplace form for you, photos included. You don&apos;t need it for the other rental
          sites.
        </p>
      )}
    </section>
  );
}

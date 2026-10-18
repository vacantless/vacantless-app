"use client";

// S723: loads Google Ads / Meta tags (only when configured, lib/ad-conversions.ts)
// and fires one-time conversions. Never rendered on renter or tenant pages.
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isMarketingPath, type AdTagConfig, type ConversionEvent } from "@/lib/ad-conversions";

type W = Window & {
  dataLayer?: unknown[];
  gtag?: (...a: unknown[]) => void;
  fbq?: ((...a: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown; callMethod?: (...a: unknown[]) => void };
  _fbq?: unknown;
  __vlTags?: boolean;
};

function addScript(src: string) {
  const s = document.createElement("script");
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

function ensureTags(cfg: AdTagConfig) {
  const w = window as W;
  if (w.__vlTags) return;
  w.__vlTags = true;
  if (cfg.googleId) {
    w.dataLayer = w.dataLayer || [];
    w.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer!.push(arguments);
    };
    w.gtag("js", new Date());
    w.gtag("config", cfg.googleId);
    addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(cfg.googleId)}`);
  }
  if (cfg.metaPixelId) {
    if (!w.fbq) {
      const n = function (...a: unknown[]) {
        if (n.callMethod) n.callMethod(...a);
        else n.queue!.push(a);
      } as NonNullable<W["fbq"]>;
      n.queue = [];
      n.loaded = true;
      n.version = "2.0";
      n.push = n;
      w.fbq = n;
      w._fbq = n;
      addScript("https://connect.facebook.net/en_US/fbevents.js");
    }
    w.fbq("init", cfg.metaPixelId);
    w.fbq("track", "PageView");
  }
}

/** Page tags on our marketing and sign-up pages. */
export function MarketingTags({ cfg }: { cfg: AdTagConfig }) {
  const path = usePathname();
  useEffect(() => {
    if (isMarketingPath(path)) ensureTags(cfg);
  }, [path, cfg]);
  return null;
}

/** Fires the given conversions once, then records them via the server action. */
export function AdConversionFire({
  cfg,
  events,
  record,
}: {
  cfg: AdTagConfig;
  events: ConversionEvent[];
  record: (events: ConversionEvent[]) => Promise<void>;
}) {
  useEffect(() => {
    if (events.length === 0) return;
    ensureTags(cfg);
    const w = window as W;
    for (const e of events) {
      const label = e === "signup" ? cfg.signupLabel : cfg.liveLabel;
      if (cfg.googleId && label && w.gtag) {
        w.gtag("event", "conversion", { send_to: `${cfg.googleId}/${label}` });
      }
      if (cfg.metaPixelId && w.fbq) {
        if (e === "signup") w.fbq("track", "CompleteRegistration");
        else w.fbq("trackCustom", "FirstRentalLive");
      }
    }
    record(events).catch(() => {});
    // fire once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

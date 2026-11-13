"use client";

// S786: while a site on this rental is still moving (posting, a Kijiji
// payment being saved, a Rentals.ca switch), refresh the page's data so the
// row changes by itself. Pauses while the tab is hidden; refreshes as soon as
// it is shown again. Renders nothing.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { refreshDelayMs } from "@/lib/posting-in-flight";

export function LiveRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    let timer: number | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
      timer = window.setTimeout(tick, refreshDelayMs(Date.now() - started));
    };
    timer = window.setTimeout(tick, refreshDelayMs(0));
    const onShow = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [active, router]);
  return null;
}

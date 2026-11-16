"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { readLinkPortalTiles } from "@/app/dashboard/link-portals/actions";

// S806 (REVIEW-S805 finding 6): the sign-in check the older sites page ran on
// open now runs here, the one sites page. For each sign-in that is due a
// check, ask the worker once, then re-read every 10 s for up to 5 minutes and
// refresh the rows when a check lands. Renders nothing.

const POLL_EVERY_MS = 10_000;
const POLL_FOR_MS = 300_000;

export function SiteChecks({
  due,
  probeEnabled,
}: {
  /** channel -> lastCheckedAt for sign-ins due a check (needsCheck or checking). */
  due: Record<string, string | null>;
  probeEnabled: boolean;
}) {
  const router = useRouter();
  const startedRef = useRef(false);

  useEffect(() => {
    const channels = Object.keys(due);
    if (!probeEnabled || startedRef.current || channels.length === 0) return;
    startedRef.current = true;
    const watched = new Map(Object.entries(due));
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const poll = async () => {
      if (cancelled) return;
      try {
        const next = await readLinkPortalTiles();
        if (cancelled) return;
        let landed = false;
        for (const row of next?.groups.flatMap((g) => g.rows) ?? []) {
          if (!watched.has(row.channel)) continue;
          if (row.lastCheckedAt && row.lastCheckedAt !== watched.get(row.channel)) {
            watched.delete(row.channel);
            landed = true;
          }
        }
        if (landed) router.refresh();
      } catch {
        // A failed poll is not a verdict; try again on the next tick.
      }
      if (watched.size > 0 && Date.now() - startedAt < POLL_FOR_MS) {
        timer = setTimeout(poll, POLL_EVERY_MS);
      }
    };

    void (async () => {
      try {
        await fetch("/api/distribution/session-check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ channels }),
        });
      } catch {
        // The worker's due filter is the real guard.
      }
      timer = setTimeout(poll, POLL_EVERY_MS);
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      startedRef.current = false;
    };
    // Mount-only: the first render decides what is due.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

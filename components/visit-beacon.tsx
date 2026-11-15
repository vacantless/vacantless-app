"use client";

import { useEffect } from "react";

// S800 (REVIEW-S799 item 8): counts one visit to this page (app/api/funnel/visit).
// Same host as the page, so no cross-site request and no extra cookie rules.
export function VisitBeacon({ page }: { page: "home" | "signup" }) {
  useEffect(() => {
    fetch(`/api/funnel/visit?page=${page}`, { method: "POST", keepalive: true }).catch(() => {});
  }, [page]);
  return null;
}

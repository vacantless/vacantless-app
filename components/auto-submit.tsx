"use client";

import { useEffect, useRef } from "react";

export function AutoSubmit({ formId }: { formId: string }) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    // Real browsers auto-fire the POST for one-tap recording; link scanners do
    // not run this JS, so GET prefetches still cannot mutate outcomes (KI585).
    // No-JS clients still have the visible Confirm button.
    const form = document.getElementById(formId) as HTMLFormElement | null;
    form?.requestSubmit();
  }, [formId]);

  return null;
}

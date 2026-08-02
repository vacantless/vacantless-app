"use client";

import { useEffect } from "react";

export function FocusActiveStep({ stepId }: { stepId: string | null }) {
  useEffect(() => {
    if (!stepId) return;
    document.getElementById(stepId)?.focus();
  }, [stepId]);

  return null;
}

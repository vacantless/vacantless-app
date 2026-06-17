"use client";

import { useFormStatus } from "react-dom";
import type { CSSProperties, ReactNode } from "react";

// A submit button that reflects the enclosing server-action form's pending
// state, so the user gets immediate feedback during the 1-3s Stripe round-trip
// instead of a button that looks frozen. Must be rendered INSIDE a <form> with
// a server action (useFormStatus reads that form's pending state).

export function SubmitButton({
  children,
  pendingLabel = "Working…",
  className,
  style,
  disabled = false,
}: {
  children: ReactNode;
  pendingLabel?: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={className}
      style={style}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

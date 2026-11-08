"use client";

import { useEffect, useRef } from "react";

// S762: the one-tap sign-in link (Today card, signed-out email, text) lands
// here with ?open=1 and the window starts without a second press. Submits the
// start form once per page load; the action redirects without ?open=1, so a
// refresh after that does not open another window.
export function AutoSubmit({ formId }: { formId: string }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const form = document.getElementById(formId);
    if (form instanceof HTMLFormElement) form.requestSubmit();
  }, [formId]);
  return (
    <p className="mt-3 text-sm text-gray-500" aria-live="polite">
      Opening the window now.
    </p>
  );
}

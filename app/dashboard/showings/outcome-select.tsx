"use client";

import { useRef } from "react";
import { SHOWING_OUTCOMES, showingOutcomeLabel } from "@/lib/pipeline";
import { updateShowingOutcome } from "./actions";

// A select that saves the showing outcome as soon as it changes.
export function OutcomeSelect({
  showingId,
  outcome,
}: {
  showingId: string;
  outcome: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={updateShowingOutcome}>
      <input type="hidden" name="id" value={showingId} />
      <select
        name="outcome"
        defaultValue={outcome}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm"
      >
        {SHOWING_OUTCOMES.map((o) => (
          <option key={o} value={o}>
            {showingOutcomeLabel(o)}
          </option>
        ))}
      </select>
    </form>
  );
}

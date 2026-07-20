"use client";

import { useRef } from "react";
import { assignShowing } from "./actions";

type Suggestion = { agentId: string; name: string; reason: string; atCapacity: boolean };

// Route a viewing to a showing agent. A native <select> that submits its form
// on change (one interaction to reassign, no separate save button — the
// minimal-clicks rule). When the org has no agents yet, the caller renders a
// "Add agents" hint instead of this control.
//
// S441 assist: for an UNASSIGNED viewing the caller may pass a `suggestion` (the
// load-balanced next agent). It renders as a one-tap "Assign {name}" chip — a
// HINT the operator accepts in a single click, never an auto-assign. The
// operator can still pick anyone from the dropdown.
export function AssignSelect({
  showingId,
  assignedAgentId,
  agents,
  suggestion,
  idSuffix,
}: {
  showingId: string;
  assignedAgentId: string | null;
  agents: { id: string; label: string }[];
  suggestion?: Suggestion | null;
  idSuffix?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const fieldId = idSuffix
    ? `assign-${showingId}-${idSuffix}`
    : `assign-${showingId}`;

  return (
    <div className="inline-flex flex-wrap items-center gap-1.5">
      {suggestion && (
        <form action={assignShowing} className="inline-flex">
          <input type="hidden" name="id" value={showingId} />
          <input type="hidden" name="agent_id" value={suggestion.agentId} />
          <button
            type="submit"
            title={`Suggested: ${suggestion.name} — ${suggestion.reason}`}
            className={
              // When the best agent is already at their weekly capacity, don't
              // dress the chip as a clean recommendation — amber + an always-
              // visible "full" marker so the operator sees they'd be overloading
              // someone (the "N left" reason is hidden on small screens; Codex
              // S441 P3). It stays tappable — operator's call.
              suggestion.atCapacity
                ? "inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                : "inline-flex items-center gap-1 rounded-lg border border-brand/30 bg-brand/5 px-2.5 py-1.5 text-xs font-medium text-brand hover:bg-brand/10"
            }
          >
            <span aria-hidden>✨</span>
            <span>Assign {suggestion.name}</span>
            {suggestion.atCapacity && <span className="font-semibold">· full</span>}
            <span
              className={`hidden font-normal sm:inline ${
                suggestion.atCapacity ? "text-amber-700" : "text-brand/70"
              }`}
            >
              · {suggestion.reason}
            </span>
          </button>
        </form>
      )}
      <form ref={formRef} action={assignShowing} className="inline-flex items-center gap-1.5">
        <input type="hidden" name="id" value={showingId} />
        <label className="sr-only" htmlFor={fieldId}>
          Assign viewing to an agent
        </label>
        <select
          id={fieldId}
          name="agent_id"
          defaultValue={assignedAgentId ?? ""}
          onChange={() => formRef.current?.requestSubmit()}
          // Point-of-action send clarity (S528): assigning emails the agent.
          // The same note lives on the Showing agents page; surface it here too.
          title="Assigning emails the agent the renter, property, and time"
          className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <option value="">Unassigned</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </form>
    </div>
  );
}

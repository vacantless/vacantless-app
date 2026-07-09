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
}: {
  showingId: string;
  assignedAgentId: string | null;
  agents: { id: string; label: string }[];
  suggestion?: Suggestion | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="inline-flex flex-wrap items-center gap-1.5">
      {suggestion && (
        <form action={assignShowing} className="inline-flex">
          <input type="hidden" name="id" value={showingId} />
          <input type="hidden" name="agent_id" value={suggestion.agentId} />
          <button
            type="submit"
            title={`Suggested: ${suggestion.name} — ${suggestion.reason}`}
            className="inline-flex items-center gap-1 rounded-lg border border-brand/30 bg-brand/5 px-2.5 py-1.5 text-xs font-medium text-brand hover:bg-brand/10"
          >
            <span aria-hidden>✨</span>
            <span>Assign {suggestion.name}</span>
            <span className="hidden font-normal text-brand/70 sm:inline">
              · {suggestion.reason}
            </span>
          </button>
        </form>
      )}
      <form ref={formRef} action={assignShowing} className="inline-flex items-center gap-1.5">
        <input type="hidden" name="id" value={showingId} />
        <label className="sr-only" htmlFor={`assign-${showingId}`}>
          Assign viewing to an agent
        </label>
        <select
          id={`assign-${showingId}`}
          name="agent_id"
          defaultValue={assignedAgentId ?? ""}
          onChange={() => formRef.current?.requestSubmit()}
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

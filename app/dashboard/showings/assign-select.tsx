"use client";

import { useRef } from "react";
import { assignShowing } from "./actions";

// Route a viewing to a showing agent. A native <select> that submits its form
// on change (one interaction to reassign, no separate save button — the
// minimal-clicks rule). When the org has no agents yet, the caller renders a
// "Add agents" hint instead of this control.
export function AssignSelect({
  showingId,
  assignedAgentId,
  agents,
}: {
  showingId: string;
  assignedAgentId: string | null;
  agents: { id: string; label: string }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
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
  );
}

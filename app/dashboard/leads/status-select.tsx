"use client";

import { useRef } from "react";
import { PIPELINE_STAGES, statusLabel, statusDescription } from "@/lib/pipeline";
import { updateLeadStatus } from "./actions";

// A select that submits the status change as soon as it changes.
export function StatusSelect({
  leadId,
  status,
}: {
  leadId: string;
  status: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={updateLeadStatus}>
      <input type="hidden" name="id" value={leadId} />
      <select
        name="status"
        defaultValue={status}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm"
      >
        {PIPELINE_STAGES.map((s) => (
          <option key={s} value={s} title={statusDescription(s)}>
            {statusLabel(s)}
          </option>
        ))}
      </select>
    </form>
  );
}

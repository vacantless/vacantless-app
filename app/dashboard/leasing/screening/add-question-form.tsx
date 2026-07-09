"use client";

// Add-a-custom-question form with progressive disclosure (S438).
//
// The three type-specific fields are only meaningful for one answer type each,
// so showing them all at once (the pre-S438 layout) made the form read as more
// complicated than it is and invited nonsense combinations (a "preferred answer"
// on a free-text question, "answer choices" on a yes/no). This island shows only
// the fields that apply to the currently-selected type:
//   - "Preferred answer"  -> yes/no only (drives the soft heads-up on a lead)
//   - "Answer choices"    -> multiple choice only
//   - "Available units"   -> no choices field; options come from live rentals
//   - "Short text"        -> neither extra field
//
// UX ONLY. The real fields still post natively to the addScreeningQuestion server
// action, which re-validates + normalizes everything (validateNewQuestion drops a
// preferred answer on a non-yes/no question and ignores choices for text/yesno),
// so nothing here is authoritative — a tampered post can't smuggle a bad combo.

import { useState } from "react";
import { addScreeningQuestion } from "@/app/dashboard/settings/actions";
import { PRIMARY_ACTION_CLASS } from "@/components/ui";
import type { QuestionType } from "@/lib/screening-questions";

export function AddQuestionForm() {
  const [qtype, setQtype] = useState<QuestionType>("text");
  const showPreferred = qtype === "yesno";
  const showChoices = qtype === "choice";
  const isUnits = qtype === "units";

  return (
    <form
      action={addScreeningQuestion}
      className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            New question
          </span>
          <input
            name="prompt"
            type="text"
            required
            maxLength={200}
            placeholder="e.g. Do you have parking needs?"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            Answer type
          </span>
          <select
            name="qtype"
            value={qtype}
            onChange={(e) => setQtype(e.target.value as QuestionType)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm sm:w-40"
          >
            <option value="text">Short text</option>
            <option value="yesno">Yes / no</option>
            <option value="choice">Multiple choice</option>
            <option value="units">Available units</option>
          </select>
        </label>
        <button className={`${PRIMARY_ACTION_CLASS} bg-brand`}>
          Add question
        </button>
      </div>

      {/* Preferred answer — yes/no only. A mismatch shows a soft heads-up on the
          lead; it never rejects, hides, or auto-flags. */}
      {showPreferred && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            Preferred answer{" "}
            <span className="font-normal text-gray-400">(optional)</span>
          </span>
          <select
            name="preferred_answer"
            defaultValue=""
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm sm:w-48"
          >
            <option value="">No preference</option>
            <option value="yes">Prefer Yes</option>
            <option value="no">Prefer No</option>
          </select>
          <span className="mt-1 block text-xs text-gray-400">
            When a renter&apos;s answer doesn&apos;t match, you&apos;ll see a soft
            heads-up on the inquiry — it never rejects or hides anyone.
          </span>
        </label>
      )}

      {/* Answer choices — multiple choice only. */}
      {showChoices && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            Answer choices{" "}
            <span className="font-normal text-gray-400">
              (one option per line, at least two)
            </span>
          </span>
          <textarea
            name="choices"
            rows={3}
            placeholder={"Studio\n1 bedroom\n2 bedroom"}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
      )}

      {/* Available units — options are generated automatically; no field. */}
      {isUnits && (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          The options are filled in automatically from your live available
          rentals, so a leased unit never appears and you never maintain a list.
          Nothing to enter here.
        </p>
      )}
    </form>
  );
}

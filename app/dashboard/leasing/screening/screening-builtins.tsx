"use client";

// Built-in pre-screening question ASK toggles (S438). Page hierarchy (S438
// follow-on): this card is only about WHICH built-in questions the renter form
// asks — the auto-flag rules live in their own card lower on the page. Master
// switch + one "Ask this on the renter form" toggle per built-in (income /
// move-in / pets / occupants). When the master is off the per-question toggles
// grey out (they have no effect until screening is on).
//
// Field NAMES match updateScreeningQuestions exactly:
//   screening_enabled, screening_ask_income/movein/pets/occupants.

import { useState } from "react";

type Props = {
  enabled: boolean;
  askIncome: boolean;
  askMovein: boolean;
  askPets: boolean;
  askOccupants: boolean;
};

export function ScreeningAskToggles({
  enabled: enabledInit,
  askIncome,
  askMovein,
  askPets,
  askOccupants,
}: Props) {
  const [enabled, setEnabled] = useState(enabledInit);

  const rows: { name: string; label: string; hint?: string; checked: boolean }[] = [
    { name: "screening_ask_income", label: "Ask household income", checked: askIncome },
    { name: "screening_ask_movein", label: "Ask move-in date", checked: askMovein },
    { name: "screening_ask_pets", label: "Ask about pets", checked: askPets },
    {
      name: "screening_ask_occupants",
      label: "Ask number of occupants",
      hint: "Captured for your context only — occupancy never auto-flags, since it can touch protected family status.",
      checked: askOccupants,
    },
  ];

  return (
    <div>
      <label className="mt-5 flex items-start gap-3">
        <input
          name="screening_enabled"
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300"
        />
        <span className="text-sm">
          <span className="block font-medium text-gray-700">
            Ask pre-screening questions
          </span>
          <span className="block text-xs text-gray-400">
            The master switch. Turn it on, then choose which questions below your
            renter form asks. Off by default.
          </span>
        </span>
      </label>

      <div
        className={`mt-4 space-y-3 ${enabled ? "" : "opacity-60"}`}
        aria-disabled={!enabled}
      >
        {rows.map((r) => (
          <label
            key={r.name}
            className="flex items-start gap-3 rounded-lg border border-gray-200 p-3"
          >
            <input
              name={r.name}
              type="checkbox"
              defaultChecked={r.checked}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm">
              <span className="block font-medium text-gray-700">
                {r.label} <span className="font-normal text-gray-400">on the renter form</span>
              </span>
              {r.hint && (
                <span className="block text-xs text-gray-400">{r.hint}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

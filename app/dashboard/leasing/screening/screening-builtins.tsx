"use client";

// Built-in pre-screening questions + auto-flags (S438 Slice 2).
//
// Each built-in (income / move-in / pets / occupants) now has its own "Ask this
// on the renter form" toggle, independent of whether its answer auto-flags. This
// island owns the live state so the flag control for a question greys out the
// moment its "ask" box is unchecked (option A: an unasked question can't flag, so
// its threshold is inert). Greyed inputs stay ENABLED so their saved value still
// submits and is preserved for when the operator turns the question back on — the
// flag is inert purely because a suppressed question yields no answer (the server
// evaluator + submit RPC need no change).
//
// Field NAMES match validateScreeningSettings / updateScreening exactly, so this
// posts inside the existing <form action={updateScreening}> unchanged:
//   screening_enabled, screening_ask_income/movein/pets/occupants,
//   screening_income_multiple, screening_max_movein_days, screening_flag_pets.

import { useState } from "react";

type Props = {
  enabled: boolean;
  askIncome: boolean;
  askMovein: boolean;
  askPets: boolean;
  askOccupants: boolean;
  incomeMultiple: number | null;
  maxMoveinDays: number | null;
  flagPets: boolean;
};

export function ScreeningBuiltins({
  enabled: enabledInit,
  askIncome: askIncomeInit,
  askMovein: askMoveinInit,
  askPets: askPetsInit,
  askOccupants: askOccupantsInit,
  incomeMultiple,
  maxMoveinDays,
  flagPets,
}: Props) {
  const [enabled, setEnabled] = useState(enabledInit);
  const [askIncome, setAskIncome] = useState(askIncomeInit);
  const [askMovein, setAskMovein] = useState(askMoveinInit);
  const [askPets, setAskPets] = useState(askPetsInit);
  const [askOccupants, setAskOccupants] = useState(askOccupantsInit);

  // A flag control is live only when screening is on AND its question is asked.
  const incomeFlagLive = enabled && askIncome;
  const moveinFlagLive = enabled && askMovein;
  const petsFlagLive = enabled && askPets;

  const inertNote = (
    <span className="ml-2 text-xs font-normal text-amber-700">
      question is off — this flag never fires
    </span>
  );

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
        className={`mt-5 space-y-5 ${enabled ? "" : "opacity-60"}`}
        aria-disabled={!enabled}
      >
        <p className="text-xs text-gray-400">
          Asking a question and flagging its answer are separate. Turn a question
          off to drop it from the form entirely; set a flag value to raise a
          &ldquo;possible mismatch&rdquo; heads-up on an answer.
        </p>

        {/* Income */}
        <div className="rounded-lg border border-gray-200 p-4">
          <label className="flex items-start gap-3">
            <input
              name="screening_ask_income"
              type="checkbox"
              checked={askIncome}
              onChange={(e) => setAskIncome(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm font-medium text-gray-700">
              Ask household income on the renter form
            </span>
          </label>
          <div className={`mt-3 ${incomeFlagLive ? "" : "opacity-50"}`}>
            <span className="mb-1 block text-sm text-gray-700">
              Flag income below (multiple of rent)
              {enabled && !askIncome && inertNote}
            </span>
            <input
              name="screening_income_multiple"
              type="number"
              min={1}
              max={20}
              step={0.5}
              defaultValue={incomeMultiple ?? ""}
              placeholder="e.g. 3"
              className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs text-gray-400">
              Blank = asked, never flags.
            </span>
          </div>
        </div>

        {/* Move-in */}
        <div className="rounded-lg border border-gray-200 p-4">
          <label className="flex items-start gap-3">
            <input
              name="screening_ask_movein"
              type="checkbox"
              checked={askMovein}
              onChange={(e) => setAskMovein(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm font-medium text-gray-700">
              Ask move-in date on the renter form
            </span>
          </label>
          <div className={`mt-3 ${moveinFlagLive ? "" : "opacity-50"}`}>
            <span className="mb-1 block text-sm text-gray-700">
              Flag move-in further out than (days)
              {enabled && !askMovein && inertNote}
            </span>
            <input
              name="screening_max_movein_days"
              type="number"
              min={1}
              max={3650}
              step={1}
              defaultValue={maxMoveinDays ?? ""}
              placeholder="e.g. 90"
              className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs text-gray-400">
              Blank = asked, never flags.
            </span>
          </div>
        </div>

        {/* Pets */}
        <div className="rounded-lg border border-gray-200 p-4">
          <label className="flex items-start gap-3">
            <input
              name="screening_ask_pets"
              type="checkbox"
              checked={askPets}
              onChange={(e) => setAskPets(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm font-medium text-gray-700">
              Ask about pets on the renter form
            </span>
          </label>
          <label
            className={`mt-3 flex items-start gap-3 ${petsFlagLive ? "" : "opacity-50"}`}
          >
            <input
              name="screening_flag_pets"
              type="checkbox"
              defaultChecked={flagPets}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">
              Flag renters with pets on rentals that aren&apos;t pet-friendly
              {enabled && !askPets && inertNote}
              <span className="block text-xs text-gray-400">
                Only applies to a rental whose &ldquo;pet-friendly&rdquo; toggle
                is off.
              </span>
            </span>
          </label>
        </div>

        {/* Occupants — informational, never flags */}
        <div className="rounded-lg border border-gray-200 p-4">
          <label className="flex items-start gap-3">
            <input
              name="screening_ask_occupants"
              type="checkbox"
              checked={askOccupants}
              onChange={(e) => setAskOccupants(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm">
              <span className="block font-medium text-gray-700">
                Ask number of occupants on the renter form
              </span>
              <span className="block text-xs text-gray-400">
                Captured for your context only — occupancy never auto-flags, since
                it can touch protected family status.
              </span>
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

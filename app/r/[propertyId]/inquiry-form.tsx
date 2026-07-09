"use client";

import { useMemo, useState } from "react";
import {
  type DaySlots,
  selectedSlotIsRendered,
  visibleBookingDays,
} from "@/lib/booking";

type ScreeningQuestion = {
  id: string;
  prompt: string;
  qtype: "text" | "yesno" | "choice" | "units";
  required: boolean;
  choices: string[];
};

type MoveInPill = { label: string; value: string };

export type InquiryFormProps = {
  // The submitLead server action, passed down so this client component can post
  // to it directly (progressive enhancement: the <form action> still submits).
  action: (formData: FormData) => void | Promise<void>;
  propertyId: string;
  trackedPostId: string | null;
  orgName: string;
  brandBg: string;
  brandColor: string;
  timezone: string | undefined;
  days: DaySlots[];
  hasClustered: boolean;
  showError: boolean;
  screeningEnabled: boolean;
  // Per-built-in ask toggles (S438 Slice 2). Each gates whether its fieldset
  // renders on the form; all default true so an org that never touched them
  // (every existing org) asks every built-in exactly as before.
  askIncome: boolean;
  askMovein: boolean;
  askPets: boolean;
  askOccupants: boolean;
  screeningQuestions: ScreeningQuestion[];
  incomeHintCents: number | null;
  rentMonthly: number | null;
  moveInPills: MoveInPill[];
  petFriendly: boolean;
};

// Tap-first renter booking form (S409 BUILD 2). Core principle: tap choices
// first, type only when necessary. Order: choose a time -> contact -> optional
// "help us prepare" pills -> confirm. It stays a real <form action={submitLead}>
// with native radio inputs for the time slots, so the server action still runs
// and a no-JS renter can still pick a time + submit; the pills/reveals/label-swap
// are the JS enhancement. Field NAMES are unchanged from the old server-rendered
// form (name/email/phone/move_in/screen_occupants/screen_pets_detail/
// screen_has_pets/screen_income/cq_<id>/notes/slot), so the submit action and the
// qualify-out RPC read exactly what they did before — this is a presentation
// reshape, not a data-model change.
export function InquiryForm({
  action,
  propertyId,
  trackedPostId,
  orgName,
  brandBg,
  brandColor,
  timezone,
  days,
  hasClustered,
  showError,
  screeningEnabled,
  askIncome,
  askMovein,
  askPets,
  askOccupants,
  screeningQuestions,
  incomeHintCents,
  rentMonthly,
  moveInPills,
  petFriendly,
}: InquiryFormProps) {
  const hasSlots = days.length > 0;

  // Which optional groups render in "Help us prepare" (S438 Slice 2). The
  // built-in move-in / occupants / pets pills are gated on their ask toggle;
  // income needs screening on AND its ask toggle; custom questions need screening
  // on. The "add a note" affordance always stays, so the fieldset is never empty.
  const showIncome = screeningEnabled && askIncome;
  const showCustomQuestions = screeningEnabled && screeningQuestions.length > 0;

  const [selectedSlot, setSelectedSlot] = useState("");
  const [showAllDays, setShowAllDays] = useState(false);

  // moveInChoice tracks WHICH pill is selected (by label, or "custom"); moveIn is
  // the value actually submitted (an ISO date, or "" for Flexible/none). Tracking
  // the choice separately lets "Flexible" (empty value) be visibly selected
  // without colliding with the unselected state.
  const [moveInChoice, setMoveInChoice] = useState<string | null>(null);
  const [moveIn, setMoveIn] = useState("");

  const [occupants, setOccupants] = useState("");
  const [petsChoice, setPetsChoice] = useState<string | null>(null);
  const [showNote, setShowNote] = useState(false);

  // Progressive sectional reveal (S438). Name + email are tracked so the optional
  // "Help us prepare" group and the Confirm button only drop in once the required
  // contact fields are filled; skipTime lets a renter who can't make the offered
  // times reveal the details section without picking a slot.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [skipTime, setSkipTime] = useState(false);

  // Pets pill -> the two fields the action already reads. "No pets" must submit
  // an EMPTY pets_detail (a non-empty detail is what the action treats as
  // "has a pet"), and only an actual pet sets screen_has_pets.
  const petsDetail = petsChoice && petsChoice !== "No pets" ? petsChoice : "";
  const hasPet = petsChoice != null && petsChoice !== "No pets";

  const petPills = useMemo(
    () => ["No pets", "Cat", "Small dog", "Dog", "Other"],
    [],
  );
  // Labels are display-only; values must parse to an integer (parseCount rejects
  // "5+"), so the 5+ pill submits "5" into the display-only screen_occupants field.
  const occupantPills = useMemo(
    () => [
      { label: "1", value: "1" },
      { label: "2", value: "2" },
      { label: "3", value: "3" },
      { label: "4", value: "4" },
      { label: "5+", value: "5" },
    ],
    [],
  );

  const selectedSlotLabel = useMemo(() => {
    if (!selectedSlot) return null;
    for (const d of days) {
      const s = d.slots.find((x) => x.iso === selectedSlot);
      if (s) return `${d.dayLabel} · ${s.label}`;
    }
    return null;
  }, [selectedSlot, days]);

  const visibleDays = visibleBookingDays(days, showAllDays);

  // A slot selected from a day that is currently collapsed (day 4+ while
  // "More times" is closed) has its radio UNMOUNTED, so it would drop out of the
  // submitted FormData and silently downgrade a "Confirm viewing" to an inquiry.
  // Track whether the selected slot's radio is actually rendered; if not, a
  // hidden fallback below keeps it in the submission (single "slot" value: the
  // unmounted radio submits nothing, so there is no collision).
  const selectedSlotVisible = useMemo(
    () => selectedSlotIsRendered(days, showAllDays, selectedSlot),
    [days, showAllDays, selectedSlot],
  );

  const confirmLabel = !hasSlots
    ? "Request a viewing"
    : selectedSlot
      ? "Confirm viewing"
      : "Send my details";

  // Which sections are revealed (S438 progressive reveal). "Your details" appears
  // once a time is chosen, the renter opts to skip picking one, or there are no
  // times to pick. The optional "Help us prepare" group + Confirm appear once the
  // required name + email are entered. Sections stay in the DOM and toggle via a
  // collapse CLASS so the <noscript> override keeps the whole form usable with JS
  // off (a no-JS renter can still book).
  const detailsRevealed = !hasSlots || selectedSlot !== "" || skipTime;
  const prepareRevealed =
    detailsRevealed && name.trim() !== "" && email.trim() !== "";
  const stepClass = (revealed: boolean) => (revealed ? "" : "vl-step-collapsed");

  const chipStyle = (active: boolean) =>
    active
      ? {
          borderColor: brandColor,
          background: brandColor,
          color: "#fff",
        }
      : undefined;

  const chipClass = (active: boolean) =>
    `cursor-pointer select-none rounded-full border px-3.5 py-2 text-sm transition ${
      active
        ? "font-medium shadow-sm"
        : "border-gray-300 text-gray-700 hover:border-gray-400"
    }`;

  return (
    <>
      {/* Progressive-reveal collapse (S438). A collapsed step is hidden for JS
          users; the <noscript> override re-shows every step so a no-JS renter
          sees and can submit the full form. */}
      <style>{`.vl-step-collapsed{display:none}`}</style>
      <noscript>
        <style>{`.vl-step-collapsed{display:revert !important}`}</style>
      </noscript>

      <h2 className="text-lg font-bold text-gray-900">
        {hasSlots ? "Book a viewing" : "Request a viewing"}
      </h2>
      <p className="mb-1 mt-1 text-sm text-gray-500">
        {hasSlots
          ? "Pick a time that works for you, or just send your details and we'll reach out."
          : "Tell us a bit about you and we'll reach out to book a time."}
      </p>
      <p className="mb-4 text-sm text-gray-500">
        This is an in-person viewing (not a phone call). You will visit the home
        at the address above.
      </p>
      {showError && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Sorry, something went wrong. Please try again.
        </p>
      )}

      <form action={action} className="space-y-5">
        <input type="hidden" name="property_id" value={propertyId} />
        {trackedPostId && (
          <input type="hidden" name="listing_post_id" value={trackedPostId} />
        )}
        {/* Client-state values ride hidden inputs so the field NAMES the submit
            action reads are unchanged. */}
        <input type="hidden" name="move_in" value={moveIn} />
        <input type="hidden" name="screen_occupants" value={occupants} />
        <input type="hidden" name="screen_pets_detail" value={petsDetail} />
        {hasPet && <input type="hidden" name="screen_has_pets" value="1" />}
        {/* Explicit "screening is on" sentinel (S438 Slice 2 P2 fold). The submit
            action used to detect screening via the income field, but income can
            now be suppressed (ask_income=false) while pets is still asked — which
            wrongly nulled the pets answer and stopped it flagging. This sentinel
            is present whenever the org has screening on, independent of which
            built-ins are asked. */}
        {screeningEnabled && (
          <input type="hidden" name="screening_on" value="1" />
        )}
        {/* Fallback so a slot chosen from a now-collapsed day still submits. */}
        {hasSlots && selectedSlot && !selectedSlotVisible && (
          <input type="hidden" name="slot" value={selectedSlot} />
        )}

        {/* STEP 1 — Choose a viewing time (primary action, first) ------------ */}
        {hasSlots && (
          <fieldset>
            <legend className="text-sm font-semibold text-gray-800">
              Choose a viewing time
            </legend>
            <p className="mb-1 mt-0.5 text-xs text-gray-400">
              Times shown in {timezone?.replace(/_/g, " ")}.
            </p>
            {hasClustered && (
              <p className="mb-2 text-xs text-gray-500">
                These times group your visit with other viewings at this
                building.
              </p>
            )}
            <div className="space-y-3">
              {visibleDays.map((day) => (
                <div key={day.dayKey}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {day.dayLabel}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {day.slots.map((s) => {
                      const active = selectedSlot === s.iso;
                      return (
                        <label key={s.iso} className={chipClass(active)} style={chipStyle(active)}>
                          <input
                            type="radio"
                            name="slot"
                            value={s.iso}
                            checked={active}
                            onChange={() => setSelectedSlot(s.iso)}
                            className="sr-only"
                          />
                          {s.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {days.length > 3 && (
              <button
                type="button"
                onClick={() => setShowAllDays((v) => !v)}
                className="mt-3 text-sm font-medium underline"
                style={{ color: brandColor }}
              >
                {showAllDays ? "Show fewer times" : "More times"}
              </button>
            )}
            {!selectedSlot && !skipTime && (
              <button
                type="button"
                onClick={() => setSkipTime(true)}
                className="mt-3 block text-sm font-medium underline"
                style={{ color: brandColor }}
              >
                Can&apos;t make these times? Send your details instead →
              </button>
            )}
          </fieldset>
        )}

        {/* STEP 2 — Your details (revealed once a time is chosen / skipped) -- */}
        <fieldset className={`space-y-3 ${stepClass(detailsRevealed)}`}>
          <legend className="text-sm font-semibold text-gray-800">
            Your details
          </legend>
          <div>
            <label htmlFor="r_name" className="mb-1 block text-sm font-medium text-gray-700">
              Full name
            </label>
            <input
              id="r_name"
              name="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="r_email" className="mb-1 block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="r_email"
                name="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="r_phone" className="mb-1 block text-sm font-medium text-gray-700">
                Phone{" "}
                <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <input
                id="r_phone"
                name="phone"
                type="tel"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-gray-400">
                If you share your number we may text you about this viewing (such
                as a confirmation and reminders). Reply STOP anytime to opt out.
              </span>
            </div>
          </div>
        </fieldset>

        {/* STEP 3 — Help us prepare (revealed once name + email are filled) - */}
        <fieldset
          className={`space-y-4 rounded-lg border border-gray-200 bg-gray-50/60 p-4 ${stepClass(prepareRevealed)}`}
        >
          <legend className="px-1 text-sm font-medium text-gray-700">
            Help us prepare for your showing{" "}
            <span className="font-normal text-gray-400">(optional)</span>
          </legend>

          {askMovein && (
          <div>
            <p className="mb-1.5 text-sm text-gray-600">Ideal move-in</p>
            <div className="flex flex-wrap gap-2">
              {moveInPills.map((p) => {
                const active = moveInChoice === p.label;
                return (
                  <button
                    key={p.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      if (active) {
                        setMoveInChoice(null);
                        setMoveIn("");
                      } else {
                        setMoveInChoice(p.label);
                        setMoveIn(p.value);
                      }
                    }}
                    className={chipClass(active)}
                    style={chipStyle(active)}
                  >
                    {p.label}
                  </button>
                );
              })}
              <button
                type="button"
                aria-pressed={moveInChoice === "custom"}
                onClick={() => {
                  setMoveInChoice("custom");
                  setMoveIn("");
                }}
                className={chipClass(moveInChoice === "custom")}
                style={chipStyle(moveInChoice === "custom")}
              >
                Pick a date
              </button>
            </div>
            {moveInChoice === "custom" && (
              <input
                type="date"
                aria-label="Desired move-in date"
                value={moveIn}
                onChange={(e) => setMoveIn(e.target.value)}
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm sm:w-56"
              />
            )}
          </div>
          )}

          {askOccupants && (
          <div>
            <p className="mb-1.5 text-sm text-gray-600">How many people?</p>
            <div className="flex flex-wrap gap-2">
              {occupantPills.map((o) => {
                const active = occupants === o.value;
                return (
                  <button
                    key={o.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setOccupants(active ? "" : o.value)}
                    className={chipClass(active)}
                    style={chipStyle(active)}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
          )}

          {askPets && (
          <div>
            <p className="mb-1.5 text-sm text-gray-600">
              Pets?{" "}
              {!petFriendly && (
                <span className="text-xs font-normal text-gray-400">
                  This home isn&apos;t pet-friendly, but let us know.
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {petPills.map((p) => {
                const active = petsChoice === p;
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setPetsChoice(active ? null : p)}
                    className={chipClass(active)}
                    style={chipStyle(active)}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>
          )}

          {/* Affordability + operator custom questions live here as a light,
              clearly-optional group (kept, not dropped, so the qualify-out RPC
              still gets income + custom answers). Income needs screening on AND
              its ask toggle (S438 Slice 2); custom questions need screening on. */}
          {(showIncome || showCustomQuestions) && (
            <div className="space-y-3 border-t border-gray-200 pt-4">
              {showIncome && (
              <div>
                <label htmlFor="r_income" className="mb-1 block text-sm text-gray-600">
                  Approximate monthly household income{" "}
                  <span className="text-gray-400">(optional)</span>
                </label>
                <div className="relative sm:w-56">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                    $
                  </span>
                  <input
                    id="r_income"
                    name="screen_income"
                    type="text"
                    inputMode="numeric"
                    placeholder="4,500"
                    className="w-full rounded-lg border border-gray-300 py-2 pl-7 pr-3 text-sm"
                  />
                </div>
                {incomeHintCents != null && rentMonthly != null && (
                  <span className="mt-1 block text-xs text-gray-500">
                    Tip: for a ${rentMonthly.toLocaleString()}/mo home, renters
                    often have a household income around $
                    {(incomeHintCents / 100).toLocaleString()}/mo. This is a
                    general guideline, not a strict requirement.
                  </span>
                )}
              </div>
              )}

              {showCustomQuestions && screeningQuestions.map((q) => {
                if (q.qtype === "units" && (q.choices?.length ?? 0) === 0) {
                  return null;
                }
                return (
                  <div key={q.id}>
                    <label htmlFor={`cq_${q.id}`} className="mb-1 block text-sm text-gray-600">
                      {q.prompt}{" "}
                      {q.required ? (
                        <span className="text-xs text-gray-500">(required)</span>
                      ) : (
                        <span className="text-gray-400">(optional)</span>
                      )}
                    </label>
                    {q.qtype === "yesno" ? (
                      <select
                        id={`cq_${q.id}`}
                        name={`cq_${q.id}`}
                        required={q.required}
                        defaultValue=""
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm sm:w-40"
                      >
                        <option value="">Select…</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    ) : q.qtype === "choice" || q.qtype === "units" ? (
                      <select
                        id={`cq_${q.id}`}
                        name={`cq_${q.id}`}
                        required={q.required}
                        defaultValue=""
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="">
                          {q.qtype === "units" ? "Select a unit…" : "Select…"}
                        </option>
                        {(q.choices ?? []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`cq_${q.id}`}
                        name={`cq_${q.id}`}
                        type="text"
                        required={q.required}
                        maxLength={500}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* "Anything else?" collapsed behind a link (S409 BUILD 2 spec §4). */}
          {showNote ? (
            <div>
              <label htmlFor="r_notes" className="mb-1 block text-sm text-gray-600">
                Anything you&apos;d like us to know?
              </label>
              <textarea
                id="r_notes"
                name="notes"
                rows={3}
                autoFocus
                placeholder="Questions, or anything you'd like us to know…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowNote(true)}
              className="text-sm font-medium underline"
              style={{ color: brandColor }}
            >
              + Add a note or question
            </button>
          )}
        </fieldset>

        {/* STEP 4 — Confirm (revealed with the optional group, once contact is
            filled) ------------------------------------------------------- */}
        <div className={`space-y-5 ${stepClass(prepareRevealed)}`}>
          {selectedSlotLabel && (
            <p className="text-sm text-gray-600">
              Selected viewing:{" "}
              <span className="font-semibold text-gray-900">
                {selectedSlotLabel}
              </span>
            </p>
          )}
          <button
            type="submit"
            className="w-full rounded-lg px-4 py-2.5 font-semibold text-white shadow-sm transition hover:opacity-90"
            style={{ background: brandBg }}
          >
            {confirmLabel}
          </button>
          {hasSlots && !selectedSlot && (
            <p className="-mt-2 text-center text-xs text-gray-400">
              No time selected — we&apos;ll reach out to arrange one.
            </p>
          )}
        </div>
      </form>
    </>
  );
}

// S812: answers to the questions renters ask most in a chat (pets, utilities,
// parking, laundry, move-in date, appliances, air conditioning), written from
// the rental's own details and the account and building defaults.
//
// One rule, the no-fake rule: an answer exists only when the record holds the
// fact. A rental that never said anything about parking gets no Parking
// answer, so a landlord can never paste a guess. Pure: no I/O.
// Used by Quick replies (lib/reply-kit); the desktop helper can read the same
// list later.

import { HELPER_REPLY_NAME, fillHelperReply } from "./marketplace-helper";
import {
  formatAvailability,
  formatParking,
  isAcType,
  isDogSize,
  isLaundry,
  isParkingType,
  type UnitFeatures,
} from "./property-features";
import { appliancesLabel, parkingFeeLabel } from "./listing-details";

export const REPLY_ANSWER_KEYS = ["pets", "utilities", "parking", "laundry", "move_in", "appliances", "ac"] as const;
export type ReplyAnswerKey = (typeof REPLY_ANSWER_KEYS)[number];

export type ReplyAnswer = {
  key: ReplyAnswerKey;
  /** The button, e.g. "Pets". */
  label: string;
  /** The answer on its own, full sentences, no greeting and no link. */
  text: string;
};

const LABELS: Record<ReplyAnswerKey, string> = {
  pets: "Pets",
  utilities: "Utilities",
  parking: "Parking",
  laundry: "Laundry",
  move_in: "Move-in date",
  appliances: "Appliances",
  ac: "Air conditioning",
};

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function capFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** A landlord's own short note as one sentence, or "" when there is none. */
function noteSentence(raw: unknown, max = 140): string {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!s || s.length > max) return "";
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

function petsAnswer(f: UnitFeatures): string | null {
  // Both must be answered (the same rule as the question sheet): one blank
  // could be "never asked", and "no dogs" would then be a guess.
  if (f.pets_cats == null || f.pets_dogs == null) return null;
  const cats = f.pets_cats === true;
  const dogs = f.pets_dogs === true;
  const size = isDogSize(f.pets_dog_size) ? f.pets_dog_size : null;
  const sizeLine = !dogs ? "" : size === "small" ? " Small dogs only." : size === "medium" ? " Small or medium dogs only." : "";
  let line: string;
  if (cats && dogs) line = `Yes, cats and dogs are welcome.${sizeLine}`;
  else if (cats) line = "Cats are welcome. Sorry, no dogs.";
  else if (dogs) line = `Dogs are welcome.${sizeLine} Sorry, no cats.`;
  else line = "Sorry, pets are not allowed in this rental.";
  const note = cats || dogs ? noteSentence(f.pets_notes) : "";
  return note ? `${line} ${note}` : line;
}

function utilitiesAnswer(f: UnitFeatures): string | null {
  const three: [string, boolean | null | undefined][] = [
    ["heat", f.heat_included],
    ["hydro", f.hydro_included],
    ["water", f.water_included],
  ];
  if (three.every(([, v]) => v == null)) return null;
  const included = three.filter(([, v]) => v === true).map(([n]) => n);
  if (f.internet_included === true) included.push("internet");
  if (f.cable_included === true) included.push("cable");
  const youPay = three.filter(([, v]) => v === false).map(([n]) => n);
  const parts: string[] = [];
  if (included.length) parts.push(`${capFirst(joinAnd(included))} ${included.length === 1 ? "is" : "are"} included in the rent.`);
  if (youPay.length) parts.push(`You pay ${joinAnd(youPay)}.`);
  return parts.length ? parts.join(" ") : null;
}

function parkingAnswer(f: UnitFeatures): string | null {
  if (isParkingType(f.parking_type)) {
    if (f.parking_type === "none") return "Sorry, there is no parking with this rental.";
    const label = formatParking(f.parking_type, f.parking_count, null);
    if (!label) return null;
    const counted = typeof f.parking_count === "number" && f.parking_count > 0;
    const base = counted
      ? `There ${Math.round(f.parking_count as number) === 1 ? "is" : "are"} ${label}`
      : `There is ${label.toLowerCase()}`;
    const fee = f.parking_type === "street" ? null : parkingFeeLabel(f.parking_fee_cents);
    if (fee === "Included") return `${base}, included in the rent.`;
    return fee ? `${base} for ${fee}.` : `${base}.`;
  }
  const text = typeof f.parking === "string" ? f.parking.replace(/\s+/g, " ").trim() : "";
  if (!text || text.length > 140) return null;
  return `Parking: ${text.replace(/[.!?]+$/, "")}.`;
}

function laundryAnswer(f: UnitFeatures): string | null {
  if (!isLaundry(f.laundry)) return null;
  if (f.laundry === "in_suite") return "Yes, there is laundry in the unit.";
  if (f.laundry === "in_building") return "There is laundry in the building.";
  if (f.laundry === "shared") return "There is shared laundry.";
  return "Sorry, there is no laundry on site.";
}

function moveInAnswer(f: UnitFeatures, now: Date): string | null {
  if (!f.available_date) return null;
  const label = formatAvailability(f.available_date, now);
  if (label === "Available now") return "It is available now.";
  return `It is available from ${label.replace(/^Available\s+/, "")}.`;
}

function appliancesAnswer(f: UnitFeatures): string | null {
  const label = appliancesLabel(f.appliances);
  return label ? `It comes with these appliances: ${label.toLowerCase()}.` : null;
}

function acAnswer(f: UnitFeatures): string | null {
  // Only the answered kind counts. The old yes/no box defaults to "no", so a
  // "no" there may mean nobody answered.
  // S822: the landlord's own note (e.g. a wall sleeve size) follows the answer.
  if (!isAcType(f.ac_type)) return null;
  const note = noteSentence(f.ac_notes);
  const base =
    f.ac_type === "none"
      ? "It does not come with air conditioning."
      : f.ac_type === "central"
        ? "Yes, it has central air."
        : f.ac_type === "sleeve"
          ? "Yes, it has a wall air conditioner."
          : `Yes, it has a ${f.ac_type} air conditioner.`;
  return note ? `${base} ${note}` : base;
}

/** The answers this rental's record can give, in the order renters ask. */
export function buildReplyAnswers(features: UnitFeatures | null | undefined, now: Date = new Date()): ReplyAnswer[] {
  const f = features ?? {};
  const made: Record<ReplyAnswerKey, string | null> = {
    pets: petsAnswer(f),
    utilities: utilitiesAnswer(f),
    parking: parkingAnswer(f),
    laundry: laundryAnswer(f),
    move_in: moveInAnswer(f, now),
    appliances: appliancesAnswer(f),
    ac: acAnswer(f),
  };
  const out: ReplyAnswer[] = [];
  for (const key of REPLY_ANSWER_KEYS) {
    const text = made[key];
    if (text) out.push({ key, label: LABELS[key], text });
  }
  return out;
}

/**
 * The whole reply for one answer: greeting, the answer, then the way to book.
 * Shorter than the first reply on purpose (no times, no phone line): it
 * answers a follow-up question.
 */
export function answerReplyText(input: {
  answer: ReplyAnswer;
  bookingUrl: string;
  hasViewingTimes: boolean;
  renterName?: string | null;
}): string {
  const tail = input.hasViewingTimes
    ? `If that works for you, you can pick a viewing time here: ${input.bookingUrl}`
    : `If that works for you, open the link and tap "Request a viewing": ${input.bookingUrl}`;
  return fillHelperReply(`Hi ${HELPER_REPLY_NAME}, thanks for asking. ${input.answer.text} ${tail}`, input.renterName ?? null);
}

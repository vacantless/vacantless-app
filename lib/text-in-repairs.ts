// ============================================================================
// text-in-repairs (S808b). A tenant texts the account's number and it becomes a
// repair request on their unit, the same as the web repair link. Noam,
// 2026-11-16, agreeing to Claude's reco: text-in repair requests on every paid
// plan, inside the monthly text limit (before this it was a Premium card line
// with nothing built behind it).
// PURE. The server half is lib/text-in-repairs-server.ts. Tests:
// scripts/test-text-in-repairs.ts.
// ============================================================================
import type { IncidentCategory } from "./incident-reports";
import { EMERGENCY_CATEGORY, callNineOneOneFirst, type EmergencyKind } from "./tenant-emergency";

/** Texts within this many minutes of the last texted request add to it. */
export const TEXT_FOLLOW_ON_MINUTES = 15;

const CATEGORY_WORDS: [IncidentCategory, RegExp][] = [
  ["pest", /\b(mice|mouse|rats?|roach(es)?|cockroach(es)?|bed ?bugs?|ants|wasps?|bees|pests?)\b/],
  ["plumbing", /\b(leak(s|ing)?|drip(s|ping)?|toilet|sink|faucet|tap|drain|clog(ged)?|pipes?|shower|tub|water heater|hot water|flood(ed|ing)?|sewage)\b/],
  ["hvac", /\b(heat(er|ing)?|furnace|boiler|radiator|thermostat|a\/?c|air ?condition(er|ing)?|cold in|too cold|too hot)\b/],
  ["electrical", /\b(outlets?|breaker|lights?|power|electric(al|ity)?|sparks?|switch(es)?|hydro)\b/],
  ["appliance", /\b(fridge|refrigerator|stove|oven|dishwasher|washer|dryer|microwave|freezer|range hood)\b/],
  ["doors_locks", /\b(locks?|keys?|door|buzzer|intercom|fob|locked out)\b/],
  ["parking", /\b(parking|parked|tow(ed)?)\b/],
  ["noise", /\b(noise|noisy|loud|music|party)\b/],
];

/** Best guess at the repair category from the text; "general" when unsure. */
export function guessRepairCategory(text: string): IncidentCategory {
  const t = text.toLowerCase();
  for (const [cat, re] of CATEGORY_WORDS) if (re.test(t)) return cat;
  return "general";
}

/**
 * Only plain, unmistakable emergency words make a texted request an emergency
 * (it then texts the landlord's emergency phone at any hour, like the web form).
 */
export function guessEmergencyKind(text: string): EmergencyKind | null {
  const t = text.toLowerCase();
  if (/\b(smell(s|ing)? (of )?gas|gas (smell|leak))\b/.test(t)) return "gas_smell";
  if (/\b(fire|smoke)\b/.test(t) && !/\bsmoke (alarm|detector)s?\b.*\b(beep|chirp|battery)/.test(t)) return "fire_smoke";
  if (/\b(sewage|sewer back)/.test(t)) return "sewage";
  if (/\b(flood(ed|ing)?|burst pipe|water (is )?(pouring|everywhere|coming through))\b/.test(t)) return "water_leak";
  if (/\b(no heat|heat (is )?(off|out|not working)|furnace (is )?(off|out|down|not working))\b/.test(t)) return "no_heat";
  if (/\bno (power|electricity|hydro)\b/.test(t)) return "no_power";
  if (/\blocked out\b/.test(t)) return "locked_out";
  return null;
}

/** The category to file: an emergency's own category wins over the word guess. */
export function textedRepairCategory(text: string): { category: IncidentCategory; emergencyKind: EmergencyKind | null } {
  const emergencyKind = guessEmergencyKind(text);
  return { category: emergencyKind ? EMERGENCY_CATEGORY[emergencyKind] : guessRepairCategory(text), emergencyKind };
}

/** True when a new text should add to the request filed moments ago, not open another. */
export function isFollowOnText(lastTextedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!lastTextedAt) return false;
  const at = Date.parse(lastTextedAt);
  return Number.isFinite(at) && now.getTime() - at >= 0 && now.getTime() - at <= TEXT_FOLLOW_ON_MINUTES * 60_000;
}

/** The one text back to the tenant. Short, plain, no em dashes. */
export function textedRepairReply(p: { orgName: string | null; reportUrl: string; emergencyKind: EmergencyKind | null }): string {
  const who = (p.orgName ?? "").trim() || "your landlord";
  const first = callNineOneOneFirst(p.emergencyKind) ? "If anyone is in danger, call 911 now. " : "";
  return `${first}Thanks, your repair request went to ${who}. Add photos or more detail here: ${p.reportUrl}`;
}

/** The marker on a texted request, so a follow-on text can find it. */
export const TEXTED_MARKER = "Sent by text.";

export function textedDescription(body: string): string {
  return `${body.trim()}\n\n${TEXTED_MARKER}`;
}

export function appendFollowOn(existing: string, body: string, max = 4000): string {
  return `${existing.trim()}\n\nAlso texted: ${body.trim()}`.slice(0, max);
}

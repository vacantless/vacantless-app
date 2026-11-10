// S776: after-hours tenant emergencies (PLAN-S775 Phase 3, migration 0281).
// The tenant's repair link asks first "Is this an emergency?". One place for
// the kinds, the words the tenant sees, the landlord's alert and the choice of
// phone. Pure: no Supabase or Next imports. The database mirrors
// EMERGENCY_KINDS in submit_incident_report and the incident_reports check.

import type { IncidentCategory } from "./incident-reports";

export const EMERGENCY_KINDS = [
  "water_leak",
  "sewage",
  "no_heat",
  "no_power",
  "gas_smell",
  "fire_smoke",
  "locked_out",
] as const;
export type EmergencyKind = (typeof EMERGENCY_KINDS)[number];

export function isEmergencyKind(v: unknown): v is EmergencyKind {
  return typeof v === "string" && (EMERGENCY_KINDS as readonly string[]).includes(v);
}

/** Blank or unknown = not an emergency. */
export function parseEmergencyKind(v: unknown): EmergencyKind | null {
  const s = String(v ?? "").trim();
  return isEmergencyKind(s) ? s : null;
}

export const EMERGENCY_LABELS: Record<EmergencyKind, string> = {
  water_leak: "Water leaking now",
  sewage: "Sewage or a toilet backing up",
  no_heat: "No heat",
  no_power: "No power",
  gas_smell: "Gas smell",
  fire_smoke: "Fire or smoke",
  locked_out: "Locked out",
};

export function emergencyLabel(kind: string | null | undefined): string | null {
  return isEmergencyKind(kind) ? EMERGENCY_LABELS[kind] : null;
}

/** The repair category an emergency files under, so the tenant need not pick one. */
export const EMERGENCY_CATEGORY: Record<EmergencyKind, IncidentCategory> = {
  water_leak: "plumbing",
  sewage: "plumbing",
  no_heat: "hvac",
  no_power: "electrical",
  gas_smell: "general",
  fire_smoke: "general",
  locked_out: "general",
};

/** Gas and fire: call 911 before anything else. */
export function callNineOneOneFirst(kind: EmergencyKind | null): boolean {
  return kind === "gas_smell" || kind === "fire_smoke";
}

/** What the tenant should do right now, shown before the form. */
export const EMERGENCY_DO_NOW: Record<EmergencyKind, string> = {
  fire_smoke: "Get everyone out and call 911 now. Then tell us below.",
  gas_smell:
    "Leave the unit now. Do not turn lights or switches on or off. Call 911 from outside. Then tell us below.",
  water_leak:
    "If you can, turn off the water at the shut-off valve. Move things away from the water.",
  sewage: "Stop using the toilets, sinks and washer until it is fixed.",
  no_heat:
    "Check that the thermostat is set to heat and the power is on. Never use the oven or a gas stove for heat.",
  no_power:
    "Check whether your neighbours have power too. If you see sparks or smell burning, call 911.",
  locked_out: "Stay somewhere safe and warm while you wait for us.",
};

/** Show the rental's emergency info (shut-offs, breaker panel) for these kinds. */
export function showsEmergencyInfo(kind: EmergencyKind | null): boolean {
  return kind === "water_leak" || kind === "sewage" || kind === "no_power" || kind === "no_heat";
}

/** The tenant's thank-you line after sending. */
export function reportThanksLine(orgName: string, emergency: boolean): string {
  return emergency
    ? `${orgName} has been alerted now and will contact you as soon as possible.`
    : `${orgName} has received the details and will get back to you during business hours.`;
}

/**
 * Where the emergency text goes: the first number that can take a text, in this
 * order: the Emergency phone, the arrival phone (the number renters already
 * text), the listing contact phone. A number with an extension cannot take a
 * text, so it is skipped. Never the account's own texting number.
 * normalize is lib/sms normalizePhoneE164, passed in to keep this file pure.
 */
export function emergencyTextTarget(
  org: {
    emergency_phone?: string | null;
    showing_arrival_phone?: string | null;
    public_contact_phone?: string | null;
  },
  ownTextingNumber: string | null,
  normalize: (raw: string | null | undefined) => string | null,
): string | null {
  for (const raw of [org.emergency_phone, org.showing_arrival_phone, org.public_contact_phone]) {
    const s = String(raw ?? "").trim();
    if (!s || /ext|x\s*\d|#/i.test(s)) continue;
    const e164 = normalize(s);
    if (e164 && e164 !== ownTextingNumber) return e164;
  }
  return null;
}

/** The landlord's emergency text. Short, one segment where it can be. */
export function emergencyAlertText(p: {
  kind: EmergencyKind;
  address: string | null;
  reporterName: string | null;
  reporterContact: string | null;
  inboxUrl: string;
}): string {
  const who = (p.reporterName ?? "").trim() || "Your tenant";
  const reach = (p.reporterContact ?? "").trim();
  const at = p.address ? ` at ${p.address}` : "";
  return `Emergency${at}: ${EMERGENCY_LABELS[p.kind]}. ${who} just reported it${
    reach ? `, reach them at ${reach}` : ""
  }. ${p.inboxUrl}`;
}

/** The landlord's emergency email subject. */
export function emergencyEmailSubject(kind: EmergencyKind, address: string | null): string {
  return `Emergency: ${EMERGENCY_LABELS[kind]}${address ? ` - ${address}` : ""}`;
}

// S717: each landlord's own texting number (migration 0248, staff-only table).
//
// An account with an enabled row texts renters from its own Twilio number,
// and texts or STOPs that arrive at that number are filed to that account
// only. Without a row, the account keeps the shared QUO number rules
// (lib/platform-switches.ts shared_sms_number).
//
// Own-number texts go to Canadian numbers only. A Canadian number texting
// Canadian phones needs no US carrier (A2P 10DLC) registration; texts to US
// phones would be filtered by US carriers, so we do not send them.
//
// Reads never throw. If the table is missing or unreadable, no account has an
// own number, which is today's behaviour.

import { normalizePhoneE164 } from "./sms";

// Canadian geographic area codes (NANP). A number outside this list is
// treated as not Canadian; the renter still gets every email.
export const CANADIAN_AREA_CODES: ReadonlySet<string> = new Set([
  "204", "226", "236", "249", "250", "257", "263", "289",
  "306", "343", "354", "365", "367", "368", "382", "387",
  "403", "416", "418", "428", "431", "437", "438", "450", "460", "468", "474",
  "506", "514", "519", "548", "568", "579", "581", "584", "587",
  "604", "613", "639", "647", "672", "683",
  "705", "709", "742", "753", "778", "780", "782",
  "807", "819", "825", "867", "873", "879",
  "902", "905", "942",
]);

/** True for a +1 number with a Canadian area code. Pure. */
export function isCanadianNumber(raw: string | null | undefined): boolean {
  const e164 = normalizePhoneE164(raw);
  if (!e164 || !/^\+1[2-9]\d{9}$/.test(e164)) return false;
  return CANADIAN_AREA_CODES.has(e164.slice(2, 5));
}

/** Staff input to a stored number, or null when it is not a Canadian +1 number. Pure. */
export function cleanOwnNumber(raw: string | null | undefined): string | null {
  const e164 = normalizePhoneE164(raw);
  return e164 && isCanadianNumber(e164) ? e164 : null;
}

type FromClient = { from: (table: string) => any };

export type OrgSmsNumberRow = {
  organization_id: string;
  phone_e164: string;
  enabled: boolean;
};

/** The account's own number when staff turned it on, else null. Never throws. */
export async function orgOwnSmsNumber(
  admin: FromClient | null | undefined,
  orgId: string | null | undefined,
): Promise<string | null> {
  if (!admin || !orgId) return null;
  try {
    const { data, error } = await admin
      .from("org_sms_numbers")
      .select("organization_id, phone_e164, enabled")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as OrgSmsNumberRow;
    return row.enabled === true ? cleanOwnNumber(row.phone_e164) : null;
  } catch {
    return null;
  }
}

/**
 * Which account owns the number a text came in to. A disabled row still
 * names its owner: a reply or STOP to a landlord's number is theirs even
 * while staff have sending paused. Null when the number is not one of ours.
 */
export async function orgForTextingNumber(
  admin: FromClient | null | undefined,
  toRaw: string | null | undefined,
): Promise<string | null> {
  const to = normalizePhoneE164(toRaw);
  if (!admin || !to) return null;
  try {
    const { data, error } = await admin
      .from("org_sms_numbers")
      .select("organization_id, phone_e164, enabled")
      .eq("phone_e164", to)
      .maybeSingle();
    if (error || !data) return null;
    return (data as OrgSmsNumberRow).organization_id ?? null;
  } catch {
    return null;
  }
}

export type SmsRoute =
  | { kind: "own"; from: string }
  | { kind: "shared" }
  | { kind: "none"; reason: "org_not_on_sms" | "not_canadian_number" };

/**
 * Where one renter text goes. Pure. An own number wins over the shared
 * number; an own number never texts a non-Canadian phone.
 */
export function routeSms(input: {
  ownNumber: string | null;
  onSharedNumber: boolean;
  to: string | null | undefined;
}): SmsRoute {
  if (input.ownNumber) {
    return isCanadianNumber(input.to)
      ? { kind: "own", from: input.ownNumber }
      : { kind: "none", reason: "not_canadian_number" };
  }
  return input.onSharedNumber ? { kind: "shared" } : { kind: "none", reason: "org_not_on_sms" };
}

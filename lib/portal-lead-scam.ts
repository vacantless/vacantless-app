// ============================================================================
// S705: hold landlord-phishing "enquiries" out of the lead list.
//
// On 2026-10-11 three messages reached Agile through Rentals.ca's own contact
// form, one per live ad, all from one sender with phone (111) 111-1111. Each
// told the LANDLORD to download and run a "Rentals Verification" program
// within 24 hours with a supplied password, "or your account will be
// blocked". They passed Rentals.ca's aligned auth (the portal really sent them;
// the scammer filled in the renter form), so sender trust cannot catch them.
// They became new leads, alerted the leasing team, and got our instant reply.
//
// The test is the SHAPE of the ask, not a word list: a real renter asks about
// a unit; this asks the landlord to install software. We hold a message only
// when it asks for a download or install AND carries at least one more of the
// scam's own tells (fake verification, a deadline threat, a program password,
// a placeholder phone, a staff-sounding sender name). One tell alone never
// holds a message, so "can I download the application form?" stays a lead.
// Pure, no I/O.
// ============================================================================

export type ScamTell =
  | "install_request"
  | "fake_verification"
  | "deadline_threat"
  | "program_password"
  | "placeholder_phone"
  | "staff_name";

const INSTALL_REQUEST: RegExp[] = [
  /\b(download|install|launch|run)\b[^.!?\n]{0,60}\b(application|program|software|app|file|tool)\b[^.!?\n]{0,40}\b(on )?your (computer|device|pc|laptop|phone)\b/i,
  /\b(install|launch) (and (launch|run|open) )?the (application|program|software)\b/i,
  /\bcopy this and paste it into your browser\b/i,
  /\byou need to (download|install|run)\b/i,
];

const FAKE_VERIFICATION: RegExp[] = [
  /\bverify your (property|account|listing|identity)\b/i,
  /\b(additional|account|property|listing) verification\b/i,
  /\bprotect (people|users|you) from fraud(ulent)?\b/i,
];

const DEADLINE_THREAT: RegExp[] = [
  /\b(account|listing|ad) will be (blocked|suspended|deleted|removed|deactivated|closed)\b/i,
  /\b(exactly|within) \d{1,2} hours\b/i,
  /\botherwise,? your (account|listing|ad)\b/i,
];

const PROGRAM_PASSWORD: RegExp[] = [
  /\bpassword (to|for) (open|run|launch|unlock)\b/i,
  /\byour (personal|one[- ]time) password\b/i,
];

const STAFF_NAME = /\b(verification|alert|support|security|admin|team|service)\b/i;

function anyMatch(patterns: RegExp[], text: string): boolean {
  return patterns.some((p) => p.test(text));
}

/** (111) 111-1111, 000-000-0000, 1234567890: a phone no renter has. */
export function isPlaceholderPhone(phone: string | null | undefined): boolean {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length < 7) return false;
  if (/^(\d)\1+$/.test(digits)) return true;
  return digits === "1234567890" || digits === "0123456789";
}

export function landlordPhishingTells(input: {
  name: string | null;
  phone: string | null;
  message: string | null;
}): ScamTell[] {
  const text = (input.message ?? "").replace(/\s+/g, " ");
  const tells: ScamTell[] = [];
  if (anyMatch(INSTALL_REQUEST, text)) tells.push("install_request");
  if (anyMatch(FAKE_VERIFICATION, text)) tells.push("fake_verification");
  if (anyMatch(DEADLINE_THREAT, text)) tells.push("deadline_threat");
  if (anyMatch(PROGRAM_PASSWORD, text)) tells.push("program_password");
  if (isPlaceholderPhone(input.phone)) tells.push("placeholder_phone");
  if (input.name && STAFF_NAME.test(input.name)) tells.push("staff_name");
  return tells;
}

/** True only for an install request backed by at least one more tell. */
export function isLandlordPhishing(input: {
  name: string | null;
  phone: string | null;
  message: string | null;
}): boolean {
  const tells = landlordPhishingTells(input);
  return tells.includes("install_request") && tells.length >= 2;
}

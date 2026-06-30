// Server-only Twilio SMS helper.
//
// Sends best-effort transactional texts to RENTERS for the two no-show-reducing
// moments: a booking confirmation and the 24h / 2h showing reminders. It mirrors
// lib/email.ts (Brevo): it reads its credentials from server-only env vars and
// DEGRADES GRACEFULLY — if the Twilio credentials are not set (or the renter
// left no usable phone, or they opted out) it simply returns { sent: false } and
// the lead/showing is unaffected. This lets the feature ship now and activate the
// moment the credentials are added to Vercel — no code change needed.
//
// Credentials (set in Vercel, server-only, NO NEXT_PUBLIC_):
//   TWILIO_ACCOUNT_SID            (AC...)
//   TWILIO_AUTH_TOKEN             (also used to validate the inbound webhook)
//   TWILIO_MESSAGING_SERVICE_SID  (MG...; preferred sender) — OR — TWILIO_FROM (+1...)
//   TWILIO_STATUS_CALLBACK_URL    (optional delivery-status webhook)
//
// Compliance: every renter-facing message carries an opt-out line ("Reply STOP
// to opt out"); inbound STOP is honored by app/api/sms/inbound (sets
// leads.sms_opt_out) and callers must skip opted-out leads before sending. These
// are TRANSACTIONAL messages tied to an appointment the renter created, so they
// are exempt from quiet-hours throttling; the quiet-hours helper below is kept
// pure + tested for any future promotional path.

import { createHmac, timingSafeEqual } from "crypto";

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01/Accounts";

export type SmsResult = { sent: boolean; reason?: string; sid?: string };

// ---------------------------------------------------------------------------
// Pure helpers (no I/O) — unit-tested in scripts/test-sms.ts.
// ---------------------------------------------------------------------------

/**
 * Normalize a free-text phone number to E.164 (e.g. "+15195551234"), or null if
 * it can't be made into a plausible number. Conservative on purpose: we'd rather
 * not send than send to a wrong number.
 *
 * The default region is North America (NANP, +1) since Vacantless is Canada/US:
 *   - already-"+"-prefixed   -> kept (digits only), if 8..15 digits
 *   - 10 digits              -> assume NANP -> +1XXXXXXXXXX
 *   - 11 digits leading "1"  -> +1XXXXXXXXXX
 *   - anything else          -> null (ambiguous; don't guess a country)
 */
export function normalizePhoneE164(
  raw: string | null | undefined,
  defaultCountryCode = "1",
): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (hasPlus) {
    // Trust an explicit country code; just sanity-check the length.
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith(defaultCountryCode)) {
    return `+${digits}`;
  }
  return null; // ambiguous without a country code — don't guess
}

/** True if two free-text numbers resolve to the same E.164 number. */
export function samePhone(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizePhoneE164(a);
  const nb = normalizePhoneE164(b);
  return na != null && nb != null && na === nb;
}

const STOP_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "UNSUB",
  "CANCEL",
  "END",
  "QUIT",
  "OPTOUT",
]);
const START_KEYWORDS = new Set(["START", "YES", "UNSTOP", "OPTIN"]);

/**
 * Classify an inbound SMS body as an opt-out (STOP family), opt-in (START
 * family), or neither. Matches Twilio's standard keyword handling: the first
 * word, case-insensitive, punctuation stripped.
 */
export function classifyInbound(body: string | null | undefined): "stop" | "start" | null {
  if (!body) return null;
  const first = body
    .trim()
    .toUpperCase()
    .split(/\s+/)[0]
    ?.replace(/[^A-Z]/g, "");
  if (!first) return null;
  if (STOP_KEYWORDS.has(first)) return "stop";
  if (START_KEYWORDS.has(first)) return "start";
  return null;
}

/**
 * True if the given instant falls within "quiet hours" in the org's timezone
 * (before startHour or at/after endHour, local). Reserved for any future
 * PROMOTIONAL SMS; transactional reminders/confirmations are exempt (the renter
 * created the appointment), so the senders below do not call this.
 */
export function isWithinQuietHours(
  date: Date,
  timeZone: string,
  startHour = 8,
  endHour = 21,
): boolean {
  let hour: number;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hour12: false,
    });
    hour = parseInt(fmt.format(date), 10);
    if (Number.isNaN(hour)) return false;
    if (hour === 24) hour = 0; // some runtimes render midnight as "24"
  } catch {
    return false; // bad tz -> don't block a send on a formatting error
  }
  return hour < startHour || hour >= endHour;
}

// Strip em/en dashes -> hyphen (house style: hyphens, never em dashes, in any
// customer-facing copy — applied as a net over the built message text).
function noEmDash(s: string): string {
  return s.replace(/[‒–—―]/g, "-");
}

const OPT_OUT_LINE = "Reply STOP to opt out.";

export type SmsCopyInput = {
  org_name: string | null;
  property_address: string | null;
  when_label: string; // already formatted in the org timezone
};

/** Booking-confirmation text. The renter just self-booked; first SMS touch. */
export function bookingConfirmationSms(p: SmsCopyInput): string {
  const org = (p.org_name || "Our leasing team").trim();
  const addr = p.property_address ? p.property_address.trim() : "the property";
  return noEmDash(
    `${org}: your viewing at ${addr} is confirmed for ${p.when_label}. ` +
      `Reply here if you need to reschedule. ${OPT_OUT_LINE}`,
  );
}

/** Showing-reminder text (24h or 2h before). */
export function showingReminderSms(p: SmsCopyInput, kind: "24h" | "2h"): string {
  const org = (p.org_name || "Our leasing team").trim();
  const addr = p.property_address ? p.property_address.trim() : "the property";
  const lead =
    kind === "2h"
      ? "your viewing is coming up soon"
      : "a reminder of your upcoming viewing";
  return noEmDash(
    `${org}: ${lead} at ${addr} on ${p.when_label}. ` +
      `Reply here to reschedule. ${OPT_OUT_LINE}`,
  );
}

/** Repair-appointment-reminder text (the day before, or the same day). */
export function repairReminderSms(p: SmsCopyInput, kind: "1d" | "sameday"): string {
  const org = (p.org_name || "Your property team").trim();
  const addr = p.property_address ? p.property_address.trim() : "your unit";
  const lead =
    kind === "sameday"
      ? "your repair visit is today"
      : "a reminder of your repair visit tomorrow";
  return noEmDash(
    `${org}: ${lead} at ${addr}, arriving ${p.when_label}. ` +
      `Please be available, or reply here to reschedule. ${OPT_OUT_LINE}`,
  );
}

/**
 * Rough SMS segment count. GSM-7 packs 160 chars (153 per part when concatenated);
 * any non-GSM char forces UCS-2 at 70 (67 per part). Used in tests to keep our
 * transactional copy within a sane (<=2) segment budget.
 */
export function smsSegments(body: string): number {
  if (!body) return 0;
  // Treat printable ASCII (+ CR/LF) as GSM-7-safe; anything else (accents,
  // emoji, smart punctuation) forces the UCS-2 budget. Good enough for our
  // English transactional copy.
  const isGsm = /^[\x20-\x7E\r\n]*$/.test(body);
  const len = body.length;
  if (isGsm) {
    if (len <= 160) return 1;
    return Math.ceil(len / 153);
  }
  if (len <= 70) return 1;
  return Math.ceil(len / 67);
}

// ---------------------------------------------------------------------------
// Inbound webhook signature (Twilio X-Twilio-Signature). Pure + testable.
// ---------------------------------------------------------------------------

/**
 * Compute Twilio's request signature: base64( HMAC-SHA1( authToken,
 * fullUrl + each POST param sorted-by-key and concatenated as key+value ) ).
 * See https://www.twilio.com/docs/usage/security#validating-requests
 */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

/** Constant-time compare of the expected vs the received signature. */
export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  received: string | null | undefined,
): boolean {
  if (!authToken || !received) return false;
  const expected = computeTwilioSignature(authToken, url, params);
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sender (I/O). Best-effort; never throws.
// ---------------------------------------------------------------------------

/** Whether enough Twilio config exists to actually send. */
export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM),
  );
}

export type SendSmsInput = { to: string | null | undefined; body: string };

/**
 * Send one SMS via the Twilio REST API (no SDK — raw fetch, mirrors the Brevo
 * helper). Never throws; returns { sent:false, reason } when unconfigured, the
 * number is unusable, or Twilio rejects it.
 */
export async function sendSms({ to, body }: SendSmsInput): Promise<SmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = process.env.TWILIO_FROM;

  if (!sid || !token || (!messagingServiceSid && !from)) {
    return { sent: false, reason: "no_credentials" };
  }
  const e164 = normalizePhoneE164(to);
  if (!e164) return { sent: false, reason: "invalid_number" };
  if (!body || !body.trim()) return { sent: false, reason: "no_body" };

  const form = new URLSearchParams();
  form.set("To", e164);
  form.set("Body", body);
  if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
  else form.set("From", from as string);
  if (process.env.TWILIO_STATUS_CALLBACK_URL) {
    form.set("StatusCallback", process.env.TWILIO_STATUS_CALLBACK_URL);
  }

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  try {
    const res = await fetch(
      `${TWILIO_API_BASE}/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${auth}`,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { sent: false, reason: `twilio_${res.status}:${detail.slice(0, 200)}` };
    }
    const json = (await res.json().catch(() => ({}))) as { sid?: string };
    return { sent: true, sid: json.sid };
  } catch (e) {
    return { sent: false, reason: `fetch_error:${(e as Error).message}` };
  }
}

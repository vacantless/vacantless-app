// S717: Settings > Message setup used to carry six separate Save buttons
// (reply-to, text messages, renter messages, viewing confirmation, auto-close,
// compliance calendar), and a change in one card was lost when the landlord
// pressed Save on another. One form now posts every card; this pure helper
// validates all of it first and returns one organizations patch.
//
// A card only counts when its marker field (has_<card>) came with the post, so
// a card the page did not render (texting on Free, compliance for non-admins)
// is never read as "turned off".

import { validateFeedbackDelayHours, validateReplyToEmail } from "./branding";

export type MessageSetupCode =
  | "invalid_reply_to"
  | "invalid_delay"
  | "invalid_confirm"
  | "invalid_autoclose"
  | "sms_upgrade";

export type MessageSetupParse =
  | {
      ok: true;
      patch: Record<string, unknown>;
      replyTo: { present: false } | { present: true; value: string | null };
      compliance: { present: false } | { present: true; enabled: boolean };
    }
  | { ok: false; code: MessageSetupCode };

type FormLike = { get(name: string): unknown };

const str = (f: FormLike, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};
const has = (f: FormLike, k: string) => f.get(k) != null;

export function parseMessageSetup(
  form: FormLike,
  ctx: { canRenterSms: boolean },
): MessageSetupParse {
  const patch: Record<string, unknown> = {};

  let replyTo: { present: false } | { present: true; value: string | null } = {
    present: false,
  };
  if (has(form, "has_reply_to")) {
    const r = validateReplyToEmail(str(form, "reply_to_email"));
    if (!r.ok) return { ok: false, code: "invalid_reply_to" };
    replyTo = { present: true, value: r.value };
  }

  if (has(form, "has_sms")) {
    const wantsOn = has(form, "sms_enabled");
    if (wantsOn && !ctx.canRenterSms) return { ok: false, code: "sms_upgrade" };
    patch.sms_enabled = wantsOn;
  }

  if (has(form, "has_renter")) {
    const delay = validateFeedbackDelayHours(str(form, "feedback_delay_hours"));
    if (!delay.ok) return { ok: false, code: "invalid_delay" };
    patch.feedback_enabled = has(form, "feedback_enabled");
    patch.feedback_delay_hours = delay.value;
    patch.nurture_enabled = has(form, "nurture_enabled");
    patch.showing_arrival_phone = str(form, "showing_arrival_phone").trim() || null;
  }

  if (has(form, "has_confirm")) {
    const modeRaw = str(form, "showing_confirm_mode").trim();
    const mode = modeRaw === "agent" ? "agent" : modeRaw === "auto" ? "auto" : null;
    const hours = Number(str(form, "auto_release_unconfirmed_hours").trim());
    if (!mode || !Number.isInteger(hours) || hours < 1 || hours > 24) {
      return { ok: false, code: "invalid_confirm" };
    }
    patch.showing_confirm_mode = mode;
    patch.auto_release_unconfirmed_enabled =
      mode === "agent" && has(form, "auto_release_unconfirmed_enabled");
    patch.auto_release_unconfirmed_hours = hours;
  }

  if (has(form, "has_autoclose")) {
    const hours = Number(str(form, "showing_autoclose_after_hours").trim());
    if (!Number.isInteger(hours) || hours < 24 || hours > 336) {
      return { ok: false, code: "invalid_autoclose" };
    }
    patch.showing_autoclose_enabled = has(form, "showing_autoclose_enabled");
    patch.showing_autoclose_after_hours = hours;
  }

  const compliance: { present: false } | { present: true; enabled: boolean } =
    has(form, "has_compliance")
      ? { present: true, enabled: has(form, "compliance_calendar_enabled") }
      : { present: false };

  return { ok: true, patch, replyTo, compliance };
}

/** The one banner the Message setup tab shows after a save. Pure. */
export function messageSetupFlash(
  code: string | undefined,
): { tone: "green" | "amber" | "red"; text: string } | null {
  switch (code) {
    case "saved":
      return { tone: "green", text: "Message setup saved." };
    case "alias_paused":
      return {
        tone: "amber",
        text: "Saved. Your reply-to changed, so your Vacantless address is paused until forwarding is checked again.",
      };
    case "sms_upgrade":
      return { tone: "amber", text: "Nothing was saved. Texting renters comes with Growth; untick it or upgrade, then save again." };
    case "invalid_reply_to":
      return { tone: "red", text: "Nothing was saved. The reply-to must be one email address, or left blank." };
    case "invalid_delay":
      return { tone: "red", text: "Nothing was saved. The feedback send delay must be a whole number of hours, 0 to 336." };
    case "invalid_confirm":
      return { tone: "red", text: "Nothing was saved. Pick a confirmation mode and a release window of 1 to 24 hours." };
    case "invalid_autoclose":
      return { tone: "red", text: "Nothing was saved. The auto-close grace window must be 24 to 336 hours." };
    case "compliance_forbidden":
      return { tone: "red", text: "Nothing was saved. Only an owner or admin can change compliance calendar reminders." };
    case "error":
      return { tone: "red", text: "Something went wrong saving. Please try again." };
    default:
      return null;
  }
}

// Pure tenant-communications domain model (no I/O) so it can be unit-tested in
// isolation.
//
// Tenant comms is platform-pivot step 3: a landlord messages the tenants on a
// tenancy (rent reminders, maintenance notices, general updates) by EMAIL and/or
// SMS. This module owns the channel abstraction, the {{token}} substitution, the
// validation for both a saved template and a one-off send, and the recipient
// resolution (who actually gets a message on each channel, after filtering for a
// usable address and the SMS opt-out). The senders (lib/email.ts, lib/sms.ts)
// and the server action stay thin around this. See migration 0033 for the schema.

import { normalizePhoneE164 } from "@/lib/sms";

// --- Channels ---------------------------------------------------------------

export const MESSAGE_CHANNELS = ["email", "sms", "both"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

// The concrete send channels (what a single delivery can be). 'both' is a
// send-time selection that fans out into these.
export const DELIVERY_CHANNELS = ["email", "sms"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

const CHANNEL_LABELS: Record<MessageChannel, string> = {
  email: "Email",
  sms: "Text (SMS)",
  both: "Email + Text",
};

export function channelLabel(channel: string): string {
  return (CHANNEL_LABELS as Record<string, string>)[channel] ?? channel;
}

export function isMessageChannel(value: string): value is MessageChannel {
  return (MESSAGE_CHANNELS as readonly string[]).includes(value);
}

/** Whether a message on `channel` is delivered over email. */
export function channelIncludesEmail(channel: MessageChannel): boolean {
  return channel === "email" || channel === "both";
}

/** Whether a message on `channel` is delivered over SMS. */
export function channelIncludesSms(channel: MessageChannel): boolean {
  return channel === "sms" || channel === "both";
}

/** The concrete delivery channels a message channel fans out to. */
export function deliveryChannelsFor(channel: MessageChannel): DeliveryChannel[] {
  const out: DeliveryChannel[] = [];
  if (channelIncludesEmail(channel)) out.push("email");
  if (channelIncludesSms(channel)) out.push("sms");
  return out;
}

// --- Token substitution -----------------------------------------------------

// The tokens an operator may use in a subject/body. Substituted per recipient.
export const MESSAGE_TOKENS = [
  "first_name",
  "full_name",
  "property_address",
  "org_name",
  "rent",
] as const;
export type MessageToken = (typeof MESSAGE_TOKENS)[number];

/**
 * Substitute {{token}} placeholders (case-insensitive, optional inner spaces).
 * An unknown token is left as-is so a stray brace never silently vanishes.
 * Pure string work — identical idiom to the renter auto-reply composer.
 */
export function applyMessageTokens(
  tpl: string,
  vars: Record<string, string>,
): string {
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k.toLowerCase())
      ? vars[k.toLowerCase()]
      : m,
  );
}

/** First word of a name, or "there" when unknown (greeting fallback). */
export function firstNameOf(name: string | null | undefined): string {
  if (!name) return "there";
  return name.trim().split(/\s+/)[0] || "there";
}

/** Integer cents -> "$1,250/month", or "" when no rent is set. */
export function formatRentForToken(cents: number | null | undefined): string {
  if (cents == null) return "";
  return "$" + Math.round(cents / 100).toLocaleString("en-CA") + "/month";
}

export type TokenContext = {
  tenantName: string | null;
  orgName: string | null;
  propertyAddress: string | null;
  rentCents: number | null;
};

/** Build the {{token}} -> value map for one recipient. */
export function tokenVarsFor(ctx: TokenContext): Record<string, string> {
  return {
    first_name: firstNameOf(ctx.tenantName),
    full_name: (ctx.tenantName ?? "").trim() || "there",
    property_address: (ctx.propertyAddress ?? "").trim() || "your home",
    org_name: (ctx.orgName ?? "").trim() || "your property manager",
    rent: formatRentForToken(ctx.rentCents),
  };
}

/** Render a template string against a recipient's context. */
export function renderForRecipient(tpl: string, ctx: TokenContext): string {
  return applyMessageTokens(tpl, tokenVarsFor(ctx));
}

// --- Validation: saved template --------------------------------------------

export type TemplateInput = {
  name: string;
  channel: string;
  subject: string | null;
  body: string;
};
export type TemplateValidation =
  | {
      ok: true;
      value: { name: string; channel: MessageChannel; subject: string | null; body: string };
    }
  | { ok: false; code: string };

/**
 * Validate a saved-template submission. Requires a name, a known channel, and a
 * body; a subject is required when the channel can send email (email/both) and
 * is dropped for sms-only.
 */
export function validateTemplateInput(v: TemplateInput): TemplateValidation {
  const name = (v.name ?? "").trim();
  const body = (v.body ?? "").trim();
  const subjectRaw = (v.subject ?? "").trim();

  if (!name) return { ok: false, code: "name" };
  if (!isMessageChannel(v.channel)) return { ok: false, code: "channel" };
  if (!body) return { ok: false, code: "body" };

  const channel = v.channel;
  if (channelIncludesEmail(channel) && !subjectRaw) {
    return { ok: false, code: "subject" };
  }
  // sms-only templates don't carry a subject.
  const subject = channelIncludesEmail(channel) ? subjectRaw : null;
  return { ok: true, value: { name, channel, subject, body } };
}

// --- Validation: one-off send ----------------------------------------------

export type MessageInput = {
  channel: string;
  subject: string | null;
  body: string;
  recipientCount: number;
};
export type MessageValidation =
  | {
      ok: true;
      value: { channel: MessageChannel; subject: string | null; body: string };
    }
  | { ok: false; code: string };

/**
 * Validate a send-message submission. Requires a known channel, a body, an
 * email subject when the channel includes email, and at least one selected
 * recipient.
 */
export function validateMessageInput(v: MessageInput): MessageValidation {
  const body = (v.body ?? "").trim();
  const subjectRaw = (v.subject ?? "").trim();

  if (!isMessageChannel(v.channel)) return { ok: false, code: "channel" };
  if (!body) return { ok: false, code: "body" };
  if (v.recipientCount <= 0) return { ok: false, code: "recipients" };

  const channel = v.channel;
  if (channelIncludesEmail(channel) && !subjectRaw) {
    return { ok: false, code: "subject" };
  }
  const subject = channelIncludesEmail(channel) ? subjectRaw : null;
  return { ok: true, value: { channel, subject, body } };
}

const ERROR_MESSAGES: Record<string, string> = {
  name: "Give the template a name.",
  channel: "Pick how this message is sent.",
  subject: "Add a subject line for the email.",
  body: "Write the message.",
  recipients: "Pick at least one tenant to message.",
  notenants: "Add a tenant with contact details before sending.",
  forbidden: "You don't have permission to message tenants.",
  notfound: "That could not be found.",
};

export function commsErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? "Something went wrong. Please check the form.";
}

// --- Recipient resolution ---------------------------------------------------

export type TenantContact = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  sms_opt_out?: boolean | null;
};

// One planned delivery: a tenant, a concrete channel, the destination it will
// go to, and (when it can't actually send) why it is being skipped.
export type PlannedDelivery = {
  tenantId: string;
  tenantName: string | null;
  channel: DeliveryChannel;
  destination: string | null;
  // present only when the delivery can't proceed (no address / opted out).
  skipReason?: "no_email" | "no_phone" | "opted_out";
};

/**
 * Resolve the concrete deliveries for a send. For each SELECTED tenant and each
 * concrete channel the message uses, produce a PlannedDelivery: a usable
 * destination, or a skip with a reason (no email / no phone / SMS opted out).
 *
 * SMS destinations are normalized to E.164 here so a tenant with an unusable
 * phone is skipped (no_phone) rather than handed to Twilio. Email is included
 * whenever a non-empty address is present (deliverability is the provider's job).
 *
 * Pure — the action layer turns these into real sends + delivery rows.
 */
export function planDeliveries(
  channel: MessageChannel,
  tenants: TenantContact[],
  selectedIds: ReadonlySet<string>,
): PlannedDelivery[] {
  const channels = deliveryChannelsFor(channel);
  const out: PlannedDelivery[] = [];

  for (const t of tenants) {
    if (!selectedIds.has(t.id)) continue;
    for (const ch of channels) {
      if (ch === "email") {
        const email = (t.email ?? "").trim();
        out.push({
          tenantId: t.id,
          tenantName: t.name,
          channel: "email",
          destination: email || null,
          ...(email ? {} : { skipReason: "no_email" as const }),
        });
      } else {
        const e164 = normalizePhoneE164(t.phone);
        if (t.sms_opt_out) {
          out.push({
            tenantId: t.id,
            tenantName: t.name,
            channel: "sms",
            destination: e164,
            skipReason: "opted_out",
          });
        } else {
          out.push({
            tenantId: t.id,
            tenantName: t.name,
            channel: "sms",
            destination: e164,
            ...(e164 ? {} : { skipReason: "no_phone" as const }),
          });
        }
      }
    }
  }
  return out;
}

/** True if a planned delivery can actually be attempted (no skip reason). */
export function isSendable(d: PlannedDelivery): boolean {
  return !d.skipReason && !!d.destination;
}

export type DeliveryTally = {
  recipientCount: number; // distinct tenants with at least one planned delivery
  sendable: number; // deliveries we will actually attempt
  skipped: number; // deliveries skipped (no address / opted out)
};

/** Summarize a plan: distinct tenants, sendable count, skipped count. */
export function tallyDeliveries(plan: PlannedDelivery[]): DeliveryTally {
  const tenants = new Set<string>();
  let sendable = 0;
  let skipped = 0;
  for (const d of plan) {
    tenants.add(d.tenantId);
    if (isSendable(d)) sendable++;
    else skipped++;
  }
  return { recipientCount: tenants.size, sendable, skipped };
}

// --- SMS body assembly ------------------------------------------------------

const SMS_OPT_OUT_LINE = "Reply STOP to opt out.";

// House style: hyphens, never em/en dashes, in customer-facing copy.
function noEmDash(s: string): string {
  return s.replace(/[‒–—―]/g, "-");
}

/**
 * Build the SMS body for a tenant message: the rendered operator text, prefixed
 * with the org name for recognizability and suffixed with the required opt-out
 * line (unless the rendered text already contains a STOP instruction). Pure.
 */
export function buildTenantSmsBody(renderedBody: string, orgName: string | null): string {
  const org = (orgName ?? "").trim();
  const text = renderedBody.trim();
  const prefixed = org ? `${org}: ${text}` : text;
  const hasOptOut = /\bSTOP\b/i.test(prefixed);
  const full = hasOptOut ? prefixed : `${prefixed} ${SMS_OPT_OUT_LINE}`;
  return noEmDash(full);
}

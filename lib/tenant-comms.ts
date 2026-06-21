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
  "business_email",
  "business_phone",
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
  // The org's public contact details (migration 0043). Optional so the existing
  // call sites that don't supply them keep compiling; when absent the
  // {{business_email}}/{{business_phone}} tokens resolve to "" (same posture as
  // an unset rent), and the composer only offers the chip when the value exists.
  orgContactEmail?: string | null;
  orgContactPhone?: string | null;
};

/** Build the {{token}} -> value map for one recipient. */
export function tokenVarsFor(ctx: TokenContext): Record<string, string> {
  return {
    first_name: firstNameOf(ctx.tenantName),
    full_name: (ctx.tenantName ?? "").trim() || "there",
    property_address: (ctx.propertyAddress ?? "").trim() || "your home",
    org_name: (ctx.orgName ?? "").trim() || "your property manager",
    rent: formatRentForToken(ctx.rentCents),
    business_email: (ctx.orgContactEmail ?? "").trim(),
    business_phone: (ctx.orgContactPhone ?? "").trim(),
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
  savefailed: "Sorry, the template didn't save. Please try again.",
  sms_locked:
    "Texting tenants is part of a higher plan. Upgrade to send texts, or message by email instead.",
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
  // present only when the delivery can't proceed (no address / opted out /
  // SMS not included on the org's plan — see applySmsEntitlement).
  skipReason?: "no_email" | "no_phone" | "opted_out" | "not_on_plan";
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

/**
 * Apply the plan's SMS entitlement to a delivery plan. When the org's plan does
 * NOT include SMS (see canUseSms in lib/billing), every SMS delivery is marked
 * skipped with reason "not_on_plan" — the entitlement is the binding constraint,
 * so it OVERRIDES any other SMS skip reason (no_phone / opted_out). Email
 * deliveries are never affected (email is free on every tier). Pure; the action
 * layer calls this right after planDeliveries so the gate is enforced
 * server-side, not just hidden in the UI.
 */
export function applySmsEntitlement(
  plan: PlannedDelivery[],
  smsAllowed: boolean,
): PlannedDelivery[] {
  if (smsAllowed) return plan;
  return plan.map((d) =>
    d.channel === "sms" ? { ...d, skipReason: "not_on_plan" as const } : d,
  );
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

// Detect an *actual* opt-out instruction the operator may have already written,
// so we don't append a duplicate line. Deliberately NOT a bare /\bSTOP\b/ — the
// word "stop" appears innocently in org names ("One-Stop Rentals") and ordinary
// copy ("please stop by the office"), and matching it there would DROP the
// required opt-out line (a compliance defect). We only treat the message as
// already carrying an opt-out instruction when it contains an actionable phrase:
// "reply/text/send/txt STOP", or "STOP to opt out / unsubscribe / cancel / quit".
const OPT_OUT_INSTRUCTION =
  /\b(?:reply|text|send|txt)\s+stop\b|\bstop\b\s+to\s+(?:opt|unsub|cancel|quit|stop)/i;

/** True if `text` already contains an SMS opt-out instruction. Exported for tests. */
export function hasOptOutInstruction(text: string): boolean {
  return OPT_OUT_INSTRUCTION.test(text);
}

// House style: hyphens, never em/en dashes, in customer-facing copy.
function noEmDash(s: string): string {
  return s.replace(/[‒–—―]/g, "-");
}

/**
 * Build the SMS body for a tenant message: the rendered operator text, prefixed
 * with the org name for recognizability and suffixed with the required opt-out
 * line (unless the rendered text already contains an opt-out INSTRUCTION — see
 * OPT_OUT_INSTRUCTION; the bare word "stop" does not count). Pure.
 */
export function buildTenantSmsBody(renderedBody: string, orgName: string | null): string {
  const org = (orgName ?? "").trim();
  const text = renderedBody.trim();
  const prefixed = org ? `${org}: ${text}` : text;
  const hasOptOut = hasOptOutInstruction(prefixed);
  const full = hasOptOut ? prefixed : `${prefixed} ${SMS_OPT_OUT_LINE}`;
  return noEmDash(full);
}

// --- Starter template seed (provisioned on onboarding) ----------------------
//
// The Tenant message centre (migration 0033) shipped with NO default templates,
// so every new org opened to a blank slate while the lease-clause library DOES
// seed defaults on onboarding. This is the parity fix: a starter pack the
// operator can edit, delete, or add to — a starting point, not a lock-in.
//
// Approved 2026-06-21 (S288) from TENANT-MESSAGE-TEMPLATES-STARTER-DRAFT, itself
// adapted from the Windsor Community Guidelines v10 into 1:1 tenant messages.
// Each body is generic + token-based (no hardcoded business name / contact /
// amount) so it reads correctly for any org. Bodies use ONLY the real
// MESSAGE_TOKENS (first_name / full_name / property_address / org_name / rent,
// plus {{business_email}}/{{business_phone}} in the Move-in welcome's contact
// block — S290; these resolve to "" until the org sets its public contact
// details in Settings, so they are deliberately placed as a labeled "Email: |
// Phone:" block that degrades to blank fields rather than broken prose, AFTER
// the always-works "reply to this message" line) —
// the draft's friendly labels {{business_name}}/{{rent_amount}} map to the
// implemented slugs {{org_name}}/{{rent}} (an unknown token would render its raw
// braces, so this mapping is load-bearing). Where a concrete date/time/amount is
// needed the body leaves a [square-bracket gap] the operator fills before
// sending. The entry-notice and late-rent copy stay within Ontario's RTA (24h
// written notice, 8am-8pm, stated purpose; no coercive late-rent language or
// invented fees). House style: hyphens, never em/en dashes.
//
// channel "both" carries the email subject + body; the SMS leg auto-derives via
// buildTenantSmsBody at send time (the data model is one body per template), and
// the operator picks the channel + trims per send.

export type SeedTemplate = {
  name: string;
  channel: MessageChannel;
  /** Required for email/both, null for sms-only (none today). */
  subject: string | null;
  body: string;
};

export const TENANT_MESSAGE_TEMPLATE_SEED: SeedTemplate[] = [
  {
    name: "Move-in welcome",
    channel: "email",
    subject: "Welcome to {{property_address}}",
    body:
      "Hi {{first_name}},\n\n" +
      "Welcome to your new home at {{property_address}}. We're glad to have you with us.\n\n" +
      "A few quick things to get you settled:\n" +
      "- The best way to reach us for anything - maintenance, questions, updates - is to reply to this message, so it's logged and we can respond quickly.\n" +
      "- You can also reach us directly - Email: {{business_email}} | Phone: {{business_phone}}\n" +
      "- For an emergency (fire, active flooding, no heat in winter, a gas odour), call 911 or local emergency services first, then let us know once you're safe.\n" +
      "- We'll follow up separately with your community guidelines and any building-specific details.\n\n" +
      "If there's anything you need in your first few weeks, just reach out.\n\n" +
      "Best,\n{{org_name}}",
  },
  {
    name: "24-hour notice of entry",
    channel: "email",
    subject: "Notice of entry - {{property_address}}",
    body:
      "Hi {{first_name}},\n\n" +
      "This is written notice that we'll need to enter your unit at {{property_address}} for the following:\n\n" +
      "- Date: [date]\n" +
      "- Time window: [start time]-[end time] (between 8 a.m. and 8 p.m.)\n" +
      "- Reason: [repair / inspection / maintenance / other]\n\n" +
      "You don't need to be home, and we'll leave everything secure. If the timing is a real problem, reply and we'll do our best to adjust.\n\n" +
      "Thank you,\n{{org_name}}",
  },
  {
    name: "Maintenance request received",
    channel: "both",
    subject: "We got your maintenance request - {{property_address}}",
    body:
      "Hi {{first_name}},\n\n" +
      "Thanks for letting us know. We've logged your request for {{property_address}} and we're arranging next steps. We'll follow up with a time once it's scheduled.\n\n" +
      "If anything about the issue changes or gets worse in the meantime, reply here and let us know.\n\n" +
      "{{org_name}}",
  },
  {
    name: "Maintenance scheduled",
    channel: "both",
    subject: "Your repair is scheduled - {{property_address}}",
    body:
      "Hi {{first_name}},\n\n" +
      "Good news - your repair at {{property_address}} is booked:\n\n" +
      "- Date: [date]\n" +
      "- Time window: [start time]-[end time]\n" +
      "- Who's coming: [contractor / our team]\n\n" +
      "You don't need to be home unless you'd prefer to be. Reply if that window doesn't work.\n\n" +
      "{{org_name}}",
  },
  {
    name: "Maintenance completed",
    channel: "both",
    subject: "All done - {{property_address}}",
    body:
      "Hi {{first_name}},\n\n" +
      "The work at {{property_address}} is complete. Please take a look when you have a moment and reply to let us know everything's working as it should. If anything still isn't right, we'll get back on it.\n\n" +
      "Thanks for your patience,\n{{org_name}}",
  },
  {
    name: "Rent reminder",
    channel: "both",
    subject: "Friendly rent reminder - {{property_address}}",
    body:
      "Hi {{first_name}},\n\n" +
      "Just a friendly reminder that your rent of {{rent}} for {{property_address}} is due on [due date]. If you've already sent it, thank you and please disregard.\n\n" +
      "If you ever have a question about a payment, just reply here.\n\n" +
      "{{org_name}}",
  },
  {
    name: "Rent received",
    channel: "both",
    subject: "Payment received - thank you",
    body:
      "Hi {{first_name}},\n\n" +
      "We've received your rent payment of {{rent}} for {{property_address}}. Thank you - nothing further is needed.\n\n" +
      "{{org_name}}",
  },
  {
    name: "Late rent - gentle nudge",
    channel: "both",
    subject: "Checking in on this month's rent - {{property_address}}",
    body:
      "Hi {{first_name}},\n\n" +
      "We haven't yet received your rent of {{rent}} for {{property_address}}, which was due on [due date]. It may simply have crossed in the mail, so please disregard if it's already on its way.\n\n" +
      "If something's come up, reply and let's talk it through - we'd rather sort it out together early.\n\n" +
      "Thank you,\n{{org_name}}",
  },
  {
    name: "Lease renewal heads-up",
    channel: "email",
    subject: "Your lease at {{property_address}}",
    body:
      "Hi {{first_name}},\n\n" +
      "Your current lease term at {{property_address}} is coming up on [renewal/anniversary date]. We'd be happy to have you stay.\n\n" +
      "In Ontario, when a fixed term ends the tenancy automatically continues month-to-month under the same conditions, so there's nothing you need to do to remain. If you'd like to talk about a new term or have any questions, just reply.\n\n" +
      "Best,\n{{org_name}}",
  },
  {
    name: "Winter heat and pipes reminder",
    channel: "both",
    subject: "A few winter reminders - {{property_address}}",
    body:
      "Hi {{first_name}},\n\n" +
      "As the cold sets in, a couple of quick reminders to keep {{property_address}} safe and comfortable:\n" +
      "- Keep the heat at a minimum of 18 C (65 F), even when you're away, to prevent frozen pipes.\n" +
      "- Please don't block radiators or baseboard heaters.\n" +
      "- Report any draft, heat loss, or unsafe icy walkway by replying here so we can address it.\n\n" +
      "Stay warm,\n{{org_name}}",
  },
  {
    name: "Move-out checklist and showings",
    channel: "email",
    subject: "Next steps for your move-out - {{property_address}}",
    body:
      "Hi {{first_name}},\n\n" +
      "Thanks for letting us know you'll be moving out of {{property_address}}. We'll make this as smooth as possible.\n\n" +
      "A few things ahead:\n" +
      "- We'll send a move-out checklist covering cleaning standards, key/fob return, and final condition.\n" +
      "- During your final 60 days we may schedule viewings with 24 hours' written notice each time - keeping the unit tidy helps keep these brief.\n" +
      "- A move-out walk-through helps return your deposit faster.\n\n" +
      "We'll be in touch with specifics. Reply any time with questions.\n\n" +
      "Best,\n{{org_name}}",
  },
];

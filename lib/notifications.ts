// Pure domain model for the per-org customizable NOTIFICATION registry
// (Option B incident-dispatch, Slice 6 substrate + the Agile→Vacantless
// teardown foundation — S327). NO DB / env / I/O here so it unit-tests cleanly
// via `npx tsx scripts/test-notifications.ts`. The impure pieces (loading the
// per-org override rows, resolving member emails, calling Brevo) live in the
// action files + lib/email.ts and use THIS module to decide what to send and to
// whom.
//
// The shape of the problem (Noam, S327): every transition notification must have
// operator-EDITABLE copy AND editable recipients, because the teardown has to
// reproduce the leasing emails Aaliyah/Agile get today without her seeing a
// difference — and some operators work portal-first (toggle the email off) while
// others (Aaliyah) work FROM the email (so the operator-facing copy carries a
// deep link back into the dashboard). So:
//   - Each notification is a registered EVENT with a code default (subject +
//     body template + audience + token set).
//   - A per-org notification_settings row (0067) OVERRIDES any of: enabled,
//     subject_template, body_template, recipients. Absence of a row == defaults.
//   - Tokens are the same {{token}} idiom as the tenant-comms composer.

import { applyMessageTokens } from "./tenant-comms";
import { formatMoneyCents } from "./payments";

// --- Audience ----------------------------------------------------------------
// Who a given event is FOR. Drives recipient resolution (operator events default
// to the org's notify list / members; trade & tenant events always include the
// natural party and treat the editable list as additive cc).
export type NotificationAudience = "operator" | "trade" | "tenant";

// --- Event registry ----------------------------------------------------------
// One entry per distinct notification. `family` groups them in the settings UI.
// `active` = wired to a real trigger this release (inactive ones are roadmap
// placeholders we DON'T surface yet, so an operator never edits a dead email).
export type NotificationEvent = {
  key: string;
  family: "dispatch" | "leasing";
  audience: NotificationAudience;
  label: string;
  description: string;
  tokens: readonly string[];
  defaultSubject: string;
  defaultBody: string;
  active: boolean;
  // Optional code-default accent color (hex #RRGGBB) for the branded email's
  // top stripe — the per-event "urgency" cue. Used when the org has set no
  // accent_color override (notification_settings.accent_color). Absent => the
  // shell falls back to the org's brand_color. leasing.new_lead defaults to an
  // alert red so a new-lead email reads like Agile's old "ACTION REQUIRED"
  // alert out of the box, while staying fully per-org overridable.
  defaultAccent?: string;
};

// Tokens available to ALL events (org + the link an email-first operator clicks
// to act in the portal). Event-specific tokens are listed per event below.
const COMMON_TOKENS = ["org_name", "property_address"] as const;

export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  // ---- Maintenance dispatch (Slice 6 — wired this release) ----------------
  {
    key: "dispatch.trade_update",
    family: "dispatch",
    audience: "operator",
    label: "Trade responded to a dispatch",
    description:
      "When a trade accepts, declines, or sends a quote for a job you dispatched. Goes to your team so you can act from your inbox.",
    tokens: [...COMMON_TOKENS, "trade_name", "job_title", "status_label", "detail", "dashboard_url"],
    defaultSubject: "{{trade_name}} {{status_label}} — {{job_title}}",
    defaultBody:
      "{{trade_name}} {{status_label}} for \"{{job_title}}\" at {{property_address}}.\n\n{{detail}}\n\nReview and respond in your dashboard: {{dashboard_url}}",
    active: true,
  },
  {
    key: "dispatch.scheduled.trade",
    family: "dispatch",
    audience: "trade",
    label: "Job scheduled — notify the trade",
    description:
      "When you approve a quote and confirm a date, the trade is told they're booked. The trade on the job is always included; add cc's below.",
    tokens: [...COMMON_TOKENS, "trade_name", "job_title", "scheduled_date", "job_url"],
    defaultSubject: "You're booked: {{job_title}} on {{scheduled_date}}",
    defaultBody:
      "Hi {{trade_name}},\n\nYou're confirmed for \"{{job_title}}\" at {{property_address}} on {{scheduled_date}}.\n\nJob details: {{job_url}}\n\nThank you,\n{{org_name}}",
    active: true,
  },
  {
    key: "dispatch.scheduled.tenant",
    family: "dispatch",
    audience: "tenant",
    label: "Maintenance scheduled — notify the tenant",
    description:
      "When work is scheduled, the tenant who reported it is told the date. The tenant on the tenancy is always included; add cc's below.",
    tokens: [...COMMON_TOKENS, "tenant_first_name", "job_title", "scheduled_date"],
    defaultSubject: "Your maintenance is scheduled for {{scheduled_date}}",
    defaultBody:
      "Hi {{tenant_first_name}},\n\nGood news — the work for \"{{job_title}}\" at {{property_address}} is scheduled for {{scheduled_date}}. We'll be in touch if anything changes.\n\nThank you,\n{{org_name}}",
    active: true,
  },
  {
    key: "dispatch.completed.tenant",
    family: "dispatch",
    audience: "tenant",
    label: "Maintenance complete — notify the tenant",
    description:
      "When you mark a dispatched job complete, the tenant who reported it is told it's done.",
    tokens: [...COMMON_TOKENS, "tenant_first_name", "job_title"],
    defaultSubject: "Your maintenance is complete",
    defaultBody:
      "Hi {{tenant_first_name}},\n\nThe work for \"{{job_title}}\" at {{property_address}} is now complete. If anything still needs attention, just reply to let us know.\n\nThank you,\n{{org_name}}",
    active: true,
  },
  {
    key: "dispatch.cancelled.trade",
    family: "dispatch",
    audience: "trade",
    label: "Dispatch cancelled — notify the trade",
    description:
      "When you pull a job back from a trade, they're told it's cancelled so they don't show up.",
    tokens: [...COMMON_TOKENS, "trade_name", "job_title"],
    defaultSubject: "Cancelled: {{job_title}}",
    defaultBody:
      "Hi {{trade_name}},\n\nThe job \"{{job_title}}\" at {{property_address}} has been cancelled. No action is needed. Sorry for any inconvenience.\n\nThank you,\n{{org_name}}",
    active: true,
  },
  {
    key: "dispatch.question.operator",
    family: "dispatch",
    audience: "operator",
    label: "Trade asked a question",
    description:
      "When a trade sends a question about a job you dispatched (often before they accept), your team is notified so you can answer from the dashboard.",
    tokens: [...COMMON_TOKENS, "trade_name", "job_title", "question", "dashboard_url"],
    defaultSubject: "{{trade_name}} asked a question — {{job_title}}",
    defaultBody:
      "{{trade_name}} asked a question about \"{{job_title}}\" at {{property_address}}:\n\n{{question}}\n\nReply from your dashboard: {{dashboard_url}}",
    active: true,
  },
  {
    key: "dispatch.reply.trade",
    family: "dispatch",
    audience: "trade",
    label: "You replied — notify the trade",
    description:
      "When you answer a trade's question, they're told there's a reply and linked back to the job. The trade on the job is always included; add cc's below.",
    tokens: [...COMMON_TOKENS, "trade_name", "job_title", "reply", "job_url"],
    defaultSubject: "Reply about {{job_title}}",
    defaultBody:
      "Hi {{trade_name}},\n\n{{org_name}} replied about \"{{job_title}}\" at {{property_address}}:\n\n{{reply}}\n\nView the job and respond: {{job_url}}\n\nThank you,\n{{org_name}}",
    active: true,
  },
  // ---- Leasing (Agile→Vacantless teardown — first leasing event) ----------
  // Replaces Agile's real-time "NEW LEAD — ACTION REQUIRED" Zap (362007976).
  // Audience operator; available to every org but fire-on-data (an org that runs
  // no leasing pipeline never triggers it). The {{dashboard_url}} action button
  // is the "work from your inbox" affordance — Aaliyah taps it to log the contact
  // without opening the grid. Every token is always supplied by the trigger (with
  // a readable fallback) so none renders as a literal {{token}}.
  {
    key: "leasing.new_lead",
    family: "leasing",
    audience: "operator",
    label: "New lead — action required",
    description:
      "When a new rental inquiry comes in, your leasing team is notified so you can reply fast. Defaults to members who manage leads; edit the recipients below.",
    tokens: [
      ...COMMON_TOKENS,
      "lead_name",
      "lead_email",
      "lead_phone",
      "move_in",
      "screening",
      "dashboard_url",
    ],
    defaultSubject: "🔴 New lead: {{lead_name}} — {{property_address}}",
    // {{screening}} expands to a labeled, multi-line block of whatever the org
    // collected (occupants / pets / income / custom questions like Employment +
    // Other units) so an email-first operator (Aaliyah) sees the screening
    // inline without opening the dashboard. It is self-contained: when the org
    // collected nothing it renders as "" and the surrounding blank lines
    // collapse, so the email still reads cleanly. Runs of blank lines collapse
    // into one paragraph break (bodyToParagraphs splits on \n{2,}).
    defaultBody:
      "🔴 New lead — action required for {{property_address}}.\n\nName: {{lead_name}}\nEmail: {{lead_email}}\nPhone: {{lead_phone}}\nMove-in: {{move_in}}\n\n{{screening}}\n\nReply fast and log the contact in your dashboard: {{dashboard_url}}",
    active: true,
    defaultAccent: "#dc2626",
  },
] as const;

export function isNotificationEventKey(key: string): boolean {
  return NOTIFICATION_EVENTS.some((e) => e.key === key);
}

export function getNotificationEvent(key: string): NotificationEvent | null {
  return NOTIFICATION_EVENTS.find((e) => e.key === key) ?? null;
}

export function activeNotificationEvents(): readonly NotificationEvent[] {
  return NOTIFICATION_EVENTS.filter((e) => e.active);
}

const FAMILY_LABELS: Record<NotificationEvent["family"], string> = {
  dispatch: "Maintenance dispatch",
  leasing: "Leasing",
};

export function notificationFamilyLabel(family: NotificationEvent["family"]): string {
  return FAMILY_LABELS[family] ?? family;
}

// --- The per-org override row (0067), as the pure layer sees it --------------
export type NotificationSettingRow = {
  event_key: string;
  enabled: boolean;
  subject_template: string | null;
  body_template: string | null;
  recipients: string[] | null;
  // Per-event branded-email top-stripe color (hex #RRGGBB), or null to follow
  // the event default / org brand. Validated on save (normalizeAccentColor).
  accent_color: string | null;
};

// --- Accent color (per-event email stripe) ----------------------------------
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** True for a strict 7-char #RRGGBB hex (the only shape we store). */
export function isHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value.trim());
}

/**
 * Normalize an operator accent-color input: a #RRGGBB hex (lower-cased) or null
 * when empty/blank. Returns `{ ok:false }` for a non-empty value that is not a
 * valid hex, so the settings UI can surface the typo rather than silently drop
 * it. A leading "#" is optional in the input; we store it canonical with "#".
 */
export function normalizeAccentColor(
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false } {
  const t = (raw ?? "").trim();
  if (t === "") return { ok: true, value: null };
  const withHash = t.startsWith("#") ? t : `#${t}`;
  if (!isHexColor(withHash)) return { ok: false };
  return { ok: true, value: withHash.toLowerCase() };
}

/**
 * Resolve the accent (top-stripe) color for one send: the org override, else the
 * event's code default, else null (the email shell then falls back to the org
 * brand color / global default). Pure.
 */
export function resolveNotificationAccent(
  event: NotificationEvent,
  setting: NotificationSettingRow | null,
): string | null {
  const override = setting?.accent_color?.trim();
  if (override && isHexColor(override)) return override.toLowerCase();
  return event.defaultAccent ?? null;
}

// --- Token rendering ---------------------------------------------------------
// A loose bag of strings; unknown tokens are left in place by applyMessageTokens.
export type NotificationTokenVars = Record<string, string>;

/** "$1,250.00" for a quote, or "" when absent — token-friendly (no "—"). */
export function formatQuoteToken(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return formatMoneyCents(cents);
}

/** First word of a name, or "there" — greeting fallback (matches tenant-comms). */
export function firstWord(name: string | null | undefined): string {
  if (!name) return "there";
  return name.trim().split(/\s+/)[0] || "there";
}

export type RenderedNotification = { subject: string; body: string };

/**
 * Render an event's subject + body for one send: pick the operator override or
 * the code default, then substitute {{tokens}}. Pure string work.
 */
export function renderNotification(
  event: NotificationEvent,
  setting: NotificationSettingRow | null,
  vars: NotificationTokenVars,
): RenderedNotification {
  const subjectTpl =
    setting?.subject_template && setting.subject_template.trim() !== ""
      ? setting.subject_template
      : event.defaultSubject;
  const bodyTpl =
    setting?.body_template && setting.body_template.trim() !== ""
      ? setting.body_template
      : event.defaultBody;
  return {
    subject: applyMessageTokens(subjectTpl, vars),
    body: applyMessageTokens(bodyTpl, vars),
  };
}

/** Is this event on for this org? Absent row == on (defaults). */
export function isEventEnabled(setting: NotificationSettingRow | null): boolean {
  return setting ? setting.enabled : true;
}

// --- Recipients --------------------------------------------------------------

// Conservative email shape — good enough to reject obvious junk in the settings
// textarea (the provider is the real validator). Mirrors the leads check.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/**
 * Parse an operator's recipients box (newline / comma / semicolon separated)
 * into a clean, de-duped, lower-cased address list. Invalid scraps are dropped
 * here for SEND; the settings validator surfaces them to the operator instead.
 */
export function parseRecipientList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[\n,;]+/)) {
    const e = part.trim().toLowerCase();
    if (e === "" || !isValidEmail(e) || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

export const MAX_NOTIFICATION_RECIPIENTS = 20;

export type RecipientsValidation =
  | { ok: true; value: string[] }
  | { ok: false; code: string; invalid: string[] };

/**
 * Validate the recipients textarea on save: collect the invalid scraps (so the
 * UI can name them) and cap the count. An empty box is valid (means "use the
 * default audience" for trade/tenant events, or "fall back to members" for
 * operator events).
 */
export function validateRecipientsInput(raw: string | null | undefined): RecipientsValidation {
  const invalid: string[] = [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of (raw ?? "").split(/[\n,;]+/)) {
    const t = part.trim();
    if (t === "") continue;
    const e = t.toLowerCase();
    if (!isValidEmail(e)) {
      invalid.push(t);
      continue;
    }
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  if (invalid.length > 0) return { ok: false, code: "bad_email", invalid };
  if (out.length > MAX_NOTIFICATION_RECIPIENTS) {
    return { ok: false, code: "too_many", invalid: [] };
  }
  return { ok: true, value: out };
}

/**
 * Resolve the final recipient set for ONE send. Pure: callers pass the already-
 * fetched pieces.
 *   - operator events: the editable list, or `operatorFallback` if it's empty
 *     (so the alert never silently goes nowhere).
 *   - trade / tenant events: the natural party (`audienceEmail`) is ALWAYS
 *     included; the editable list is additive cc.
 * Always de-duped, lower-cased, valid-only, and capped.
 */
export function resolveNotificationRecipients(args: {
  audience: NotificationAudience;
  configured: string[]; // already-parsed editable list (parseRecipientList)
  audienceEmail?: string | null; // the trade / tenant address for this send
  operatorFallback?: string[]; // member/contact emails for operator events
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | null | undefined) => {
    if (!raw) return;
    const e = raw.trim().toLowerCase();
    if (e === "" || !isValidEmail(e) || seen.has(e)) return;
    seen.add(e);
    out.push(e);
  };

  if (args.audience === "operator") {
    const list = args.configured.length > 0 ? args.configured : args.operatorFallback ?? [];
    list.forEach(push);
  } else {
    push(args.audienceEmail);
    args.configured.forEach(push);
  }
  return out.slice(0, MAX_NOTIFICATION_RECIPIENTS);
}

// --- Operator status copy (for the dispatch.trade_update event) --------------
// The single operator event covers accept / decline / quote; these helpers fill
// its {{status_label}} + {{detail}} tokens so the body reads naturally for each.
export function tradeUpdateStatusLabel(kind: "accepted" | "declined" | "quoted"): string {
  switch (kind) {
    case "accepted":
      return "accepted the job";
    case "declined":
      return "declined the job";
    case "quoted":
      return "sent a quote";
  }
}

export function tradeUpdateDetail(
  kind: "accepted" | "declined" | "quoted",
  opts: { quoteCents?: number | null; note?: string | null; declineReason?: string | null },
): string {
  if (kind === "quoted") {
    const amount = formatQuoteToken(opts.quoteCents);
    const base = amount ? `Quote: ${amount}.` : "A quote was submitted.";
    return opts.note && opts.note.trim() !== "" ? `${base} Note: ${opts.note.trim()}` : base;
  }
  if (kind === "declined") {
    return opts.declineReason && opts.declineReason.trim() !== ""
      ? `Reason: ${opts.declineReason.trim()}`
      : "No reason was given.";
  }
  return "They're ready to quote the work.";
}

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

// --- Send mode ---------------------------------------------------------------
// HOW a registered event reaches its audience — the second tier of the locked
// send-mode decision (S340). Three values on ONE axis so the compliance-comms
// "drip" (a landlord-to-tenant message stream, compliance-triggered) can carry
// every step from a friendly reminder to a legal notice without parallel
// machinery:
//   - "notify"          fire-and-send to the audience when the trigger happens
//                       (today's behavior; operator alerts + the action-driven
//                       tenant dispatch emails all sit here). Absent => this.
//   - "approve_to_send" the trigger only DRAFTS the message into the pending
//                       queue (pending_tenant_messages, 0075); a human operator
//                       must open it, optionally edit, and tap Approve & Send
//                       before it ever reaches the tenant. The soft/operational
//                       comms tier (filter / water / smoke test / insurance /
//                       entry notice / the renewal courtesy). NEVER auto-sends —
//                       so it is inherently dark/safe even when "on".
//   - "served_notice"   a legal LTB notice routed through the #11 signing rail
//                       with a delivery record (Slice 3) — GATED behind a legal/
//                       ToS pass; not wired this release.
export type NotificationSendMode = "notify" | "approve_to_send" | "served_notice";

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
  // HOW this event reaches its audience (see NotificationSendMode). Absent =>
  // "notify" (the default behavior every event shipped with). Only the new
  // compliance-drip tenant events declare "approve_to_send".
  sendMode?: NotificationSendMode;
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
  // Repair-appointment reminder to the tenant (S387, Slice 4). Once an operator
  // confirms a repair appointment (work_order_appointments.chosen_date + window),
  // the appointment-reminder cron texts/emails the tenant the DAY BEFORE and the
  // SAME DAY so they're home for the supplier's arrival window — closing the loop
  // on the repair-scheduling matcher so the operator stops chasing confirmations.
  // Audience tenant; the tenant on the work order's tenancy is the recipient.
  // SHIP DARK: opt-in per org (the cron requires an explicit enabled override via
  // isDripEnqueueEnabled), so nothing fires until the operator turns it on. The
  // EMAIL leg needs no entitlement; the SMS leg is Premium (repair_sms) and is
  // sent separately by the cron with its own opt-out + stamp. {{reminder_lead}}
  // renders "tomorrow" or "today"; {{appointment_window}} is the arrival window
  // (e.g. "Jul 1: 8:00 AM - 12:00 PM"). No alert accent (a friendly heads-up).
  {
    key: "leasing.repair_appointment_reminder",
    family: "dispatch",
    audience: "tenant",
    label: "Repair visit reminder — notify the tenant",
    description:
      "Once you confirm a repair appointment, the tenant gets a reminder the day before and again the same day so they're home for the arrival window. Goes to the tenant on the job's tenancy. The text-message version needs a Premium plan; email is always included. Off until you turn it on.",
    tokens: [...COMMON_TOKENS, "tenant_first_name", "job_title", "appointment_window", "reminder_lead"],
    defaultSubject: "Reminder: your repair visit {{reminder_lead}}",
    defaultBody:
      "Hi {{tenant_first_name}},\n\nThis is a reminder that the repair visit for \"{{job_title}}\" at {{property_address}} is scheduled for {{appointment_window}} ({{reminder_lead}}).\n\nThe technician arrives sometime within that window, so please make sure someone can be there to let them in.\n\nIf the time no longer works, just reply to this email and we'll reschedule.\n\nThank you,\n{{org_name}}",
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
    label: "New inquiry",
    description:
      "When a new rental inquiry comes in, your leasing team is notified so you can reply fast. Defaults to members who manage inquiries; edit the recipients below.",
    tokens: [
      ...COMMON_TOKENS,
      "lead_name",
      "lead_email",
      "lead_phone",
      "move_in",
      "screening",
      "dashboard_url",
    ],
    defaultSubject: "New inquiry from {{lead_name}} — {{property_address}}",
    // {{screening}} expands to a labeled, multi-line block of whatever the org
    // collected (occupants / pets / income / custom questions like Employment +
    // Other units) so an email-first operator (Aaliyah) sees the screening
    // inline without opening the dashboard. It is self-contained: when the org
    // collected nothing it renders as "" and the surrounding blank lines
    // collapse, so the email still reads cleanly. Runs of blank lines collapse
    // into one paragraph break (bodyToParagraphs splits on \n{2,}).
    defaultBody:
      "New inquiry from {{lead_name}} for {{property_address}}.\n\nName: {{lead_name}}\nEmail: {{lead_email}}\nPhone: {{lead_phone}}\nMove-in: {{move_in}}\n\n{{screening}}\n\nReply when you can and log the contact in your dashboard: {{dashboard_url}}",
    active: true,
  },
  // Post-showing outcome nudge (S391). Audience operator; the push half of the
  // showing funnel — once a showing's time has passed with no outcome recorded,
  // the operator gets ONE "how did the viewing go?" email with a one-tap
  // {{outcome_url}} (Attended / No-show / Cancelled), so recording an outcome
  // stops being a pull nobody does. SHIP DARK: opt-in per org (the cron requires
  // an explicit enabled override via isDripEnqueueEnabled), so nothing fires
  // until the operator turns it on. The one-tap page records via POST (never a
  // GET side-effect) so email link-scanners can't auto-record. Wired by the cron
  // in a later slice; registered here so Settings can surface + route it per org.
  {
    key: "leasing.showing_outcome_nudge",
    family: "leasing",
    audience: "operator",
    label: "Post-showing outcome reminder",
    description:
      "After a viewing's time passes with no outcome recorded, your team gets a one-tap reminder to mark it Attended, No-show, or Cancelled — so your renter list stays accurate and attended viewings move the renter forward automatically. Defaults to members who manage inquiries; edit the recipients below. Off until you turn it on.",
    tokens: [...COMMON_TOKENS, "lead_name", "showing_time", "outcome_url"],
    defaultSubject: "How did the viewing go? - {{lead_name}} at {{property_address}}",
    defaultBody:
      "The viewing for {{lead_name}} at {{property_address}} ({{showing_time}}) has passed and no outcome is recorded yet.\n\nTap to record it - Attended, No-show, or Cancelled: {{outcome_url}}\n\nMarking it Attended moves this renter forward automatically and keeps your renter list accurate.",
    active: true,
  },
  // Daily leasing snapshot digest (Agile→Vacantless teardown — replaces the
  // scheduled daily Zap 365197456). Audience operator; ONE email per weekday at
  // start-of-shift summarizing four buckets, not one-per-event. The scheduled
  // builder (app/api/cron/leasing-snapshot) fills {{snapshot}} with the four
  // labeled sections (built by lib/leasing-snapshot.ts) and supplies the count
  // tokens; the substrate handles copy/recipients/branding. Fire-on-data: an
  // org with an empty snapshot gets no email. Informational, so no alert accent.
  {
    key: "leasing.daily_snapshot",
    family: "leasing",
    audience: "operator",
    label: "Daily leasing snapshot",
    description:
      "Once each weekday, at the start of your shift, a single digest of new inquiries, today's viewings, viewings later this week, and inquiries still waiting on a viewing. Quiet days send nothing. Defaults to members who manage inquiries; edit the recipients below.",
    tokens: [
      "org_name",
      "snapshot_date",
      "new_count",
      "showings_today_count",
      "snapshot",
      "dashboard_url",
    ],
    defaultSubject:
      "Leasing snapshot — {{snapshot_date}}: {{new_count}} new (24h), {{showings_today_count}} showing(s) today",
    defaultBody:
      "Here is today's leasing snapshot for {{snapshot_date}}.\n\n{{snapshot}}\n\nThis is a daily status view, not a to-do backlog — nothing here is overdue. One email per weekday at the start of your shift.\n\nOpen your inquiries: {{dashboard_url}}",
    active: true,
  },
  // Rent-increase autopilot (the FREE compliance wedge — S339). The proactive
  // half of the already-shipped engine (lib/rent-increase.ts + lib/n1-render.ts):
  // a per-tenancy reminder fired by app/api/cron/rent-increase when a unit enters
  // the actionable band (serve_window / serve_late / overdue) so the operator is
  // told WHEN to serve the N1 instead of having to open the dashboard. Audience
  // operator; one email per tenancy (deadline-specific, unlike the org-wide
  // snapshot). Once-per-cycle: the cron stamps tenancies.rent_increase_nudged_for
  // so a given increase cycle nudges at most once. {{dashboard_url}} deep-links to
  // the tenancy where the rent-increase card + the pre-filled N1 button already
  // live. Informational-but-actionable → no alert accent (not an emergency).
  {
    key: "leasing.rent_increase",
    family: "leasing",
    audience: "operator",
    label: "Rent increase due — serve the N1",
    description:
      "When one of your tenancies reaches its annual rent-increase window, you get a reminder of the date you must serve the Form N1 and the guideline amount — so you never leave a legal increase on the table. One email per unit, once per cycle. Defaults to members who manage inquiries; edit the recipients below.",
    tokens: [
      ...COMMON_TOKENS,
      "tenant_names",
      "serve_by_date",
      "effective_date",
      "guideline_percent",
      "current_rent",
      "new_rent",
      "dashboard_url",
    ],
    defaultSubject:
      "Rent increase: serve the N1 by {{serve_by_date}} — {{property_address}}",
    defaultBody:
      "It's time to start the annual rent increase for {{property_address}}.\n\nTenant(s): {{tenant_names}}\nServe the Form N1 by: {{serve_by_date}}\nIncrease effective: {{effective_date}}\nGuideline: {{guideline_percent}}\nRent: {{current_rent}} → {{new_rent}}/mo\n\nOpen the tenancy to review the details and print the pre-filled N1: {{dashboard_url}}",
    active: true,
  },
  // Rent-increase TENANT courtesy note (the compliance-comms drip — S341). The
  // SOFT, non-legal companion to leasing.rent_increase: when a tenancy reaches
  // its annual window, the operator can send the tenant a friendly heads-up that
  // their fixed term is approaching and ask whether they intend to stay — WITHOUT
  // implying they must renew (most Ontario fixed terms continue month-to-month
  // unless properly ended; the LTB N9/N11 paths handle an actual end). This is
  // NOT the Form N1 and carries no legal weight — the N1 stays a separate
  // operator-served document (leasing.rent_increase + the pre-filled N1 route).
  //
  // sendMode "approve_to_send": the rent-increase cron only DRAFTS this into the
  // pending_tenant_messages queue (0075); the operator reviews/edits and taps
  // Approve & Send before it reaches the tenant. Enqueue is OPT-IN per org
  // (isDripEnqueueEnabled — an explicit enabled override), so it stays dark until
  // an operator turns the drip on. audience tenant; no alert accent (courtesy).
  {
    key: "leasing.rent_increase_tenant_notice",
    family: "leasing",
    audience: "tenant",
    sendMode: "approve_to_send",
    label: "Rent increase — courtesy note to the tenant",
    description:
      "An optional, friendly heads-up to the tenant when their lease anniversary approaches, asking whether they intend to stay — drafted for you to review and send, never sent automatically. This is a courtesy note, not the legal Form N1 (you still serve the N1 separately). Off until you turn it on.",
    tokens: [
      ...COMMON_TOKENS,
      "tenant_first_name",
      "effective_date",
      "dashboard_url",
    ],
    defaultSubject: "A quick note about your lease at {{property_address}}",
    defaultBody:
      "Hi {{tenant_first_name}},\n\nWe're reaching out ahead of your lease anniversary at {{property_address}}. There's nothing you need to do right now — your tenancy simply continues unless you choose otherwise.\n\nWhen you have a moment, we'd love to know: are you planning to stay on for another year? There's no pressure either way — we just want to plan ahead. A separate notice with any rent details will follow if applicable.\n\nThanks,\n{{org_name}}",
    active: true,
  },
  // ---- Seasonal compliance calendar (S343 — the soft-comms drip build-out) ----
  // The first follow-on slice of the send-mode axis after the S341 keystone: a
  // set of SOFT, non-legal seasonal courtesy notes to the tenant, each fired by
  // a fixed-calendar trigger (app/api/cron/compliance-calendar) when its lead
  // window opens. They ride the SAME approve_to_send substrate as the rent-
  // increase courtesy note — the cron only DRAFTS into pending_tenant_messages
  // (0075); a human operator reviews/edits and taps Approve & Send before the
  // tenant ever receives one. Enqueue is OPT-IN per org (isDripEnqueueEnabled),
  // so every seasonal note ships dark until an operator turns that event on.
  //
  // These are operational/courtesy comms with NO legal weight — deliberately
  // distinct from the LTB form-driven items (N1..N14), which stay notify-the-
  // landlord + a link to the official form (never auto-served, never invented
  // copy). audience tenant; no alert accent (friendly, not urgent). Tokens:
  // {{tenant_first_name}} {{property_address}} {{season_year}} {{org_name}}.
  {
    key: "leasing.seasonal_furnace_filter",
    family: "leasing",
    audience: "tenant",
    sendMode: "approve_to_send",
    label: "Seasonal: furnace filter reminder",
    description:
      "As the heating season begins, an optional friendly reminder to the tenant to replace the furnace filter — drafted for you to review and send, never sent automatically. A courtesy note, not a legal notice. Off until you turn it on.",
    tokens: [...COMMON_TOKENS, "tenant_first_name", "season_year"],
    defaultSubject: "A quick seasonal reminder for {{property_address}}",
    defaultBody:
      "Hi {{tenant_first_name}},\n\nAs we head into the heating season, this is a friendly reminder to replace the furnace filter at {{property_address}}. A fresh filter keeps the heat running efficiently and the air cleaner. If the filter for your unit is one we look after, just let us know and we'll take care of it.\n\nThanks,\n{{org_name}}",
    active: true,
  },
  {
    key: "leasing.seasonal_water_shutoff",
    family: "leasing",
    audience: "tenant",
    sendMode: "approve_to_send",
    label: "Seasonal: outdoor water shut-off",
    description:
      "Before the first frost, an optional reminder to the tenant to disconnect garden hoses and prepare outdoor faucets for winter — drafted for you to review and send, never sent automatically. A courtesy note, not a legal notice. Off until you turn it on.",
    tokens: [...COMMON_TOKENS, "tenant_first_name", "season_year"],
    defaultSubject: "Outdoor water shut-off for the winter — {{property_address}}",
    defaultBody:
      "Hi {{tenant_first_name}},\n\nWith colder weather on the way, it's time to prepare the outdoor faucets at {{property_address}} for winter. Please disconnect and drain any garden hoses so the exterior taps don't freeze. If the outdoor water supply needs to be shut off at the valve, we'll be in touch to arrange a convenient time.\n\nThanks,\n{{org_name}}",
    active: true,
  },
  {
    key: "leasing.seasonal_smoke_co_test",
    family: "leasing",
    audience: "tenant",
    sendMode: "approve_to_send",
    label: "Seasonal: smoke & CO alarm test",
    description:
      "An optional seasonal reminder to the tenant to test their smoke and carbon-monoxide alarms and report any that aren't working — drafted for you to review and send, never sent automatically. A courtesy note, not a legal notice. Off until you turn it on.",
    tokens: [...COMMON_TOKENS, "tenant_first_name", "season_year"],
    defaultSubject: "Time to test your smoke & CO alarms — {{property_address}}",
    defaultBody:
      "Hi {{tenant_first_name}},\n\nThis is a friendly seasonal reminder to test the smoke and carbon-monoxide alarms in your home at {{property_address}} and make sure each one is working. If any alarm is missing, chirping, or doesn't sound when you test it, please let us know right away and we'll arrange a replacement.\n\nThanks,\n{{org_name}}",
    active: true,
  },
  {
    key: "leasing.seasonal_water_turnon",
    family: "leasing",
    audience: "tenant",
    sendMode: "approve_to_send",
    label: "Seasonal: outdoor water turn-on",
    description:
      "Once the frost risk has passed, an optional reminder to the tenant that the outdoor faucets are being readied for spring — drafted for you to review and send, never sent automatically. A courtesy note, not a legal notice. Off until you turn it on.",
    tokens: [...COMMON_TOKENS, "tenant_first_name", "season_year"],
    defaultSubject: "Outdoor water is coming back on — {{property_address}}",
    defaultBody:
      "Hi {{tenant_first_name}},\n\nNow that the risk of frost has passed, we're getting the outdoor faucets at {{property_address}} ready for the warmer months. If you'd like the exterior water turned back on, just let us know and we'll arrange it. It's also a good time to check the outdoor taps for any drips after the winter.\n\nThanks,\n{{org_name}}",
    active: true,
  },
  {
    key: "leasing.seasonal_dryer_vent",
    family: "leasing",
    audience: "tenant",
    sendMode: "approve_to_send",
    label: "Seasonal: dryer-vent cleaning",
    description:
      "A mid-winter fire-safety reminder to the tenant to clear lint from the dryer's vent and lint trap — drafted for you to review and send, never sent automatically. A courtesy note, not a legal notice. Off until you turn it on.",
    tokens: [...COMMON_TOKENS, "tenant_first_name", "season_year"],
    defaultSubject: "A quick dryer safety reminder for {{property_address}}",
    defaultBody:
      "Hi {{tenant_first_name}},\n\nThis is a friendly reminder to clean out the dryer's lint trap and check the vent at {{property_address}}. Built-up lint is a common fire hazard and also makes the dryer work harder than it needs to. If the vent runs somewhere you can't easily reach, just let us know and we'll arrange to have it cleared.\n\nThanks,\n{{org_name}}",
    active: true,
  },
  {
    key: "leasing.seasonal_ac_startup",
    family: "leasing",
    audience: "tenant",
    sendMode: "approve_to_send",
    label: "Seasonal: AC startup & cooling filter",
    description:
      "Ahead of the cooling season, an optional reminder to the tenant to test the air conditioning and replace the filter before the first hot stretch — drafted for you to review and send, never sent automatically. A courtesy note, not a legal notice. Off until you turn it on.",
    tokens: [...COMMON_TOKENS, "tenant_first_name", "season_year"],
    defaultSubject: "Getting ready for the cooling season — {{property_address}}",
    defaultBody:
      "Hi {{tenant_first_name}},\n\nWith warmer weather on the way, this is a friendly reminder to test the air conditioning at {{property_address}} and replace the filter so it's ready before the first hot stretch. Running it for a few minutes now is the easiest way to catch any issue early. If the AC doesn't cool the way it should, please let us know and we'll arrange a service.\n\nThanks,\n{{org_name}}",
    active: true,
  },
  {
    key: "leasing.seasonal_eavestrough",
    family: "leasing",
    audience: "tenant",
    sendMode: "approve_to_send",
    label: "Seasonal: eavestrough clearing",
    description:
      "After the leaves have fallen, an optional reminder about clearing the eavestroughs and downspouts before winter — drafted for you to review and send, never sent automatically. A courtesy note, not a legal notice. Off until you turn it on.",
    tokens: [...COMMON_TOKENS, "tenant_first_name", "season_year"],
    defaultSubject: "Clearing the eavestroughs before winter — {{property_address}}",
    defaultBody:
      "Hi {{tenant_first_name}},\n\nNow that most of the leaves have come down, it's a good time to clear the eavestroughs and downspouts at {{property_address}} so melting snow and ice can drain freely this winter. If clearing the eavestroughs is something we look after for your home, you don't need to do anything — we'll take care of it.\n\nThanks,\n{{org_name}}",
    active: true,
  },
  {
    key: "leasing.seasonal_winter_walkways",
    family: "leasing",
    audience: "tenant",
    sendMode: "approve_to_send",
    label: "Seasonal: winter walkways & ice",
    description:
      "As winter sets in, an optional reminder to the tenant about keeping walkways and steps clear of snow and ice, and reporting slippery spots — drafted for you to review and send, never sent automatically. A courtesy note, not a legal notice. Off until you turn it on.",
    tokens: [...COMMON_TOKENS, "tenant_first_name", "season_year"],
    defaultSubject: "Keeping walkways safe this winter — {{property_address}}",
    defaultBody:
      "Hi {{tenant_first_name}},\n\nWith winter weather setting in, this is a friendly reminder to help keep the walkways, steps, and entrances at {{property_address}} clear of snow and ice so everyone stays safe. If clearing snow and salting is something we look after for your home, you don't need to do anything — and either way, please let us know right away about any icy or slippery spots so we can take care of them.\n\nThanks,\n{{org_name}}",
    active: true,
  },
  // ---- Landlord-notify compliance reminders (S357 — the landlord tier) --------
  // The third send-mode build-out: ANNUAL landlord-side compliance reminders that
  // go to the OPERATOR (audience operator, sendMode notify — the registry default,
  // same as leasing.rent_increase), NOT the tenant. The compliance-calendar cron
  // (app/api/cron/compliance-calendar) fires each on a fixed-calendar trigger when
  // its lead window opens (LANDLORD_CALENDAR_ITEMS in lib/compliance-calendar) and
  // emails the operator ONCE per org per season — its at-most-once guard is the
  // compliance_reminder_log table (0079), not a tenant draft.
  //
  // These are the LANDLORD'S OWN recurring obligations (insurance, heating-system
  // service, smoke/CO alarm compliance), so they read as a to-do reminder TO the
  // operator, with {{dashboard_url}} as the "work from your inbox" link. They are
  // operational reminders, NOT legal LTB-served notices (N1..N14 stay separate,
  // notify-the-landlord + official form, gated behind a legal pass — never auto-
  // served, never invented copy). Like the seasonal tenant drip they are OPT-IN
  // per org (the cron requires an explicit enabled override; isDripEnqueueEnabled),
  // so each ships dark until the operator turns it on. No alert accent (planning
  // reminders, not emergencies). Tokens: {{org_name}} {{season_year}}
  // {{dashboard_url}} + the common {{property_address}} (renders generically here).
  {
    key: "leasing.landlord_insurance_review",
    family: "leasing",
    audience: "operator",
    label: "Annual: review your property insurance",
    description:
      "Once a year, a reminder to review and renew your landlord/property insurance — confirm the policy is current, reflects the rental use, and that coverage and rebuild value are still adequate. Goes to your team, not the tenant. Off until you turn it on.",
    tokens: [...COMMON_TOKENS, "season_year", "dashboard_url"],
    defaultSubject: "Annual reminder: review your property insurance ({{season_year}})",
    defaultBody:
      "It's a good time for your yearly insurance check.\n\nA quick annual review of your landlord/property insurance helps avoid surprises at claim time:\n\n- Confirm the policy is active and renews on schedule.\n- Make sure it reflects that the property is a rental (a homeowner policy often won't cover a tenanted unit).\n- Check the rebuild/replacement value and liability limits are still adequate.\n- Consider requiring tenants to carry their own contents + liability insurance.\n\nReview your units and records in your dashboard: {{dashboard_url}}",
    active: true,
  },
  {
    key: "leasing.landlord_furnace_service",
    family: "leasing",
    audience: "operator",
    label: "Annual: book the heating-system service",
    description:
      "Ahead of the heating season, a reminder to schedule a licensed technician to service the furnace/heating systems across your units — a safety and efficiency check that many insurers also expect. Goes to your team, not the tenant. Off until you turn it on.",
    tokens: [...COMMON_TOKENS, "season_year", "dashboard_url"],
    defaultSubject: "Time to book the annual heating-system service ({{season_year}})",
    defaultBody:
      "Heating season is approaching — a good time to book your annual furnace/heating service.\n\nA yearly inspection by a licensed technician keeps the systems running safely and efficiently, helps catch a failing heat exchanger (a carbon-monoxide risk) before the cold sets in, and is often a condition of your insurance.\n\n- Schedule service for the heating systems across your units.\n- Keep the service record on file.\n- Replace or arrange replacement of furnace filters where you're responsible.\n\nOpen your units in the dashboard: {{dashboard_url}}",
    active: true,
  },
  {
    key: "leasing.landlord_fire_safety",
    family: "leasing",
    audience: "operator",
    label: "Annual: smoke & CO alarm compliance",
    description:
      "A yearly reminder of your legal duty as the landlord to provide and maintain working smoke and carbon-monoxide alarms, and to keep a record. Goes to your team, not the tenant — it pairs with the optional tenant 'test your alarms' courtesy note. Off until you turn it on.",
    tokens: [...COMMON_TOKENS, "season_year", "dashboard_url"],
    defaultSubject: "Annual smoke & CO alarm compliance check ({{season_year}})",
    defaultBody:
      "A yearly reminder about your alarm obligations as the landlord.\n\nUnder Ontario's Fire Code (O. Reg. 213/07), the landlord is responsible for installing and maintaining working smoke alarms and, where there is a fuel-burning appliance or an attached garage, carbon-monoxide alarms — and for keeping a maintenance record.\n\n- Verify a working smoke alarm on every storey and outside sleeping areas of each unit.\n- Verify CO alarms where required.\n- Test, replace dead batteries, and replace any alarm past its expiry.\n- Log the date you checked each unit.\n\nYou can also send tenants the optional 'test your smoke & CO alarms' courtesy note from your dashboard: {{dashboard_url}}",
    active: true,
  },
  // Vacant Home Tax declaration — two timed nudges (60 days, then 30 days) ahead
  // of the municipal deadline. Toronto's declaration for the prior occupancy year
  // is due April 30; Ottawa (Vacant Unit Tax) and Hamilton run their own annual
  // declarations on their own dates, so the copy names Toronto's date but tells
  // the operator to confirm their municipality. EVERY residential owner in a
  // participating city must declare each year (even a principal residence) or the
  // city assumes the home is vacant and bills the tax — exactly the easy-to-forget,
  // deadline-driven obligation this tier exists for. Two separate events (not one)
  // so each fires once per season on its own window via the standard cron path; a
  // future "mark this year done" suppression can gate the 30-day one later.
  {
    key: "leasing.landlord_vacant_home_tax_60d",
    family: "leasing",
    audience: "operator",
    label: "Vacant Home Tax: declaration due in ~2 months",
    description:
      "An early reminder (about 60 days out) to file your municipal Vacant Home Tax declaration for each residential property. Toronto's deadline is April 30; other cities differ. Goes to your team, not the tenant. Off until you turn it on.",
    tokens: [...COMMON_TOKENS, "season_year", "dashboard_url"],
    defaultSubject: "Vacant Home Tax declaration opens — due in about 2 months ({{season_year}})",
    defaultBody:
      "A heads-up so the Vacant Home Tax declaration doesn't sneak up on you.\n\nMany Ontario municipalities now require an ANNUAL vacant-home declaration for every residential property — even your principal residence. If you miss it, the city can assume the home was vacant and bill you the tax.\n\n- In Toronto, the declaration for the prior year is due April 30. Ottawa and Hamilton run their own declarations on their own dates — confirm yours.\n- File one declaration per residential property you own.\n- Keep the confirmation for your records.\n\nThis is your early (~2 months out) reminder; you'll get one more about a month before the deadline. Review your properties in your dashboard: {{dashboard_url}}",
    active: true,
  },
  {
    key: "leasing.landlord_vacant_home_tax_30d",
    family: "leasing",
    audience: "operator",
    label: "Vacant Home Tax: declaration due in ~1 month",
    description:
      "A final reminder (about 30 days out) to file your municipal Vacant Home Tax declaration if you haven't already. Toronto's deadline is April 30; other cities differ. Goes to your team, not the tenant. Off until you turn it on.",
    tokens: [...COMMON_TOKENS, "season_year", "dashboard_url"],
    defaultSubject: "Reminder: Vacant Home Tax declaration due in about a month ({{season_year}})",
    defaultBody:
      "A final nudge on the Vacant Home Tax declaration.\n\nIf you've already filed for each of your residential properties, you can ignore this. If not, the deadline is close — and missing it means the city can assume the home was vacant and bill you the tax.\n\n- In Toronto, the declaration for the prior year is due April 30. Confirm the date for your municipality (Ottawa and Hamilton differ).\n- File one declaration per residential property.\n- Keep the confirmation for your records.\n\nFile now and you're done for the year. Review your properties in your dashboard: {{dashboard_url}}",
    active: true,
  },
  // Freehold winterization — the LANDLORD-side companion to the tenant outdoor-
  // water note. For houses/freehold units you look after directly (and any vacant
  // or between-tenants unit), a reminder to shut off and drain the exterior water
  // supply before the first frost so a hose bib or supply line doesn't freeze and
  // burst. Condos don't have this, so the copy says "freehold/houses". Goes to the
  // operator, not the tenant; pairs with leasing.seasonal_water_shutoff (tenant).
  {
    key: "leasing.landlord_winter_water_shutoff",
    family: "leasing",
    audience: "operator",
    label: "Freehold: shut off outdoor water before winter",
    description:
      "Before the first frost, a reminder to shut off and drain the exterior water supply on the freehold houses you manage directly — especially any vacant or between-tenants unit — so an outdoor faucet or supply line doesn't freeze and burst. Goes to your team, not the tenant. Off until you turn it on.",
    tokens: [...COMMON_TOKENS, "season_year", "dashboard_url"],
    defaultSubject: "Winterize the outdoor water on your freehold units ({{season_year}})",
    defaultBody:
      "Frost is on the way — time to winterize the outdoor water on the houses you look after.\n\nFor your freehold/house units (and any vacant or between-tenants unit especially), a frozen hose bib or supply line can split and cause a costly flood:\n\n- Shut off the interior valve that feeds each exterior faucet, then open the outside tap to drain the line.\n- Disconnect and store garden hoses.\n- Blow out or drain any irrigation/sprinkler lines.\n- For an occupied unit, coordinate with the tenant (you can send them the 'outdoor water shut-off' courtesy note from your dashboard).\n\nReview your properties in your dashboard: {{dashboard_url}}",
    active: true,
  },
  {
    // Asset-tracked detector replacement reminder (S359). Unlike the GENERIC
    // annual landlord_fire_safety ("check your alarms"), this fires per UNIT from
    // the recorded detector inventory (unit_detectors) when a specific detector
    // reaches its manufacturer end-of-life — anchored to each detector's install
    // date (a per-record sweep, app/api/cron/detector-eol), not the seasonal
    // calendar. Opt-in per org (isDripEnqueueEnabled) so it ships dark.
    key: "leasing.landlord_detector_eol",
    family: "leasing",
    audience: "operator",
    label: "Detectors reaching end of life",
    description:
      "When the smoke / carbon-monoxide detectors you've logged for a unit reach their manufacturer end-of-life (~10 years for smoke and combo, ~7 for CO-only), you get one reminder per unit — so you order the right type and replace the whole unit's set in one trip instead of reacting to a beep. Goes to your team, not the tenant. Built from each unit's Detectors list; off until you turn it on.",
    tokens: [...COMMON_TOKENS, "detector_list", "earliest_eol", "dashboard_url"],
    defaultSubject: "Detectors due for replacement — {{property_address}}",
    defaultBody:
      "Some of the smoke / carbon-monoxide detectors you've logged at {{property_address}} are reaching their manufacturer end-of-life:\n\n{{detector_list}}\n\nOrder the right type now — a combination smoke + CO unit is not interchangeable with a smoke-only one — so you can replace the whole unit's set in a single trip. Please confirm each detector's manufacturer date and your local fire code; service life is typically ~10 years for smoke and combination alarms and ~7 for CO-only.\n\nReview or update this unit's detector inventory: {{dashboard_url}}",
    active: true,
  },
  {
    // Major-equipment end-of-life reminder (S361). The asset-tracked sibling of
    // landlord_detector_eol: fires off the recorded equipment inventory
    // (unit_equipment) when a water heater / furnace reaches its manufacturer
    // end-of-life — anchored to each item's install date (a per-record sweep,
    // app/api/cron/equipment-eol), not the seasonal calendar. Per-type lead
    // window (water heater 120d, furnace 180d). Opt-in per org
    // (isDripEnqueueEnabled) so it ships dark.
    key: "leasing.landlord_equipment_eol",
    family: "leasing",
    audience: "operator",
    label: "Major equipment reaching end of life",
    description:
      "When the water heaters and furnaces you've logged for a unit reach their manufacturer end-of-life (~10 years for tank water heaters, ~15 for furnaces), you get one reminder per unit — with enough lead time to plan the replacement on your schedule instead of reacting to a failure. Goes to your team, not the tenant. Built from each unit's Equipment list; off until you turn it on.",
    tokens: [...COMMON_TOKENS, "equipment_list", "earliest_eol", "dashboard_url"],
    defaultSubject: "Major equipment due for replacement — {{property_address}}",
    defaultBody:
      "Some of the major equipment you've logged at {{property_address}} is reaching its manufacturer end-of-life:\n\n{{equipment_list}}\n\nPlan the replacement now, while you can do it on your own schedule. A tank water heater past ~10 years carries a rising risk of leaking and causing water damage, and a furnace is best replaced in the off-season before the next heating season — both cost considerably more as an emergency. Please confirm each item's manufacturer date.\n\nReview or update this unit's equipment: {{dashboard_url}}",
    active: true,
  },
  {
    // Appliance WARRANTY reminder (S362). The one-shot, asset-tracked sibling of
    // landlord_equipment_eol: fires off the recorded appliance inventory
    // (unit_appliances) when an appliance's manufacturer warranty is about to
    // lapse — anchored to each appliance's purchase date + warranty length (a
    // per-record sweep, app/api/cron/appliance-care), not the seasonal calendar.
    // Opt-in per org (isDripEnqueueEnabled) so it ships dark.
    key: "leasing.landlord_appliance_warranty",
    family: "leasing",
    audience: "operator",
    label: "Appliance warranty expiring",
    description:
      "When the manufacturer warranty on an appliance you've logged for a unit is about to lapse (~6 weeks out), you get one reminder per unit — so you can register it or use the coverage before it runs out. Goes to your team, not the tenant. Built from each unit's Appliances list; off until you turn it on.",
    tokens: [...COMMON_TOKENS, "appliance_list", "earliest_date", "dashboard_url"],
    defaultSubject: "Appliance warranty expiring soon — {{property_address}}",
    defaultBody:
      "The manufacturer warranty on some appliances you've logged at {{property_address}} is about to lapse:\n\n{{appliance_list}}\n\nIf you haven't registered these with the manufacturer, now is the time — and if anything has been acting up, get it looked at while the coverage still applies. Please confirm each purchase date and your warranty terms.\n\nReview or update this unit's appliances: {{dashboard_url}}",
    active: true,
  },
  {
    // Appliance CONSUMABLE reminder (S362) — the RECURRING primitive. Unlike every
    // other asset reminder (which fires once per lifecycle), this re-arms on a
    // cycle: a labelled consumable (e.g. a fridge water filter) with an interval
    // in months, anchored to the last replacement. Fires once per cycle when the
    // next due date is near; a one-tap "Mark replaced" on the unit's Appliances
    // list rolls the schedule forward. Per-record sweep, app/api/cron/appliance-
    // care. Opt-in per org (isDripEnqueueEnabled) so it ships dark.
    key: "leasing.landlord_appliance_consumable",
    family: "leasing",
    audience: "operator",
    label: "Appliance consumable due",
    description:
      "For appliance consumables you track on a cycle (a fridge water filter, a range-hood filter), you get one reminder per unit when one is due — so you order the right part and swap it on time. After you replace it, tap “Mark replaced” on the unit's Appliances list and the next reminder is scheduled automatically. Goes to your team, not the tenant; off until you turn it on.",
    tokens: [...COMMON_TOKENS, "appliance_list", "earliest_date", "dashboard_url"],
    defaultSubject: "Appliance consumable due — {{property_address}}",
    defaultBody:
      "Some appliance consumables you track at {{property_address}} are due for replacement:\n\n{{appliance_list}}\n\nOrder the right part now so it's a quick swap. Once it's done, tap “Mark replaced” on the unit's Appliances list and we'll schedule the next reminder for you.\n\nReview or update this unit's appliances: {{dashboard_url}}",
    active: true,
  },
  {
    // Renter's-insurance lapse reminder (S382). The tenancy-scoped sibling of the
    // unit asset reminders (landlord_equipment_eol / landlord_detector_eol): fires
    // off the recorded per-tenancy insurance policies (tenancy_insurance) when a
    // policy is expiring or has lapsed — anchored to each policy's EXPIRY date (a
    // per-record sweep, app/api/cron/tenancy-insurance), not the seasonal
    // calendar. Default 30-day lead window. Opt-in per org (isDripEnqueueEnabled)
    // so it ships dark.
    key: "leasing.landlord_insurance_lapse",
    family: "leasing",
    audience: "operator",
    label: "Renter's insurance expiring or lapsed",
    description:
      "If your lease requires the tenant to carry renter's (contents + liability) insurance, log their policy on the tenancy and we'll email you about a month before it expires — and again if it lapses — so you can ask for renewed proof before there's a coverage gap. One reminder per tenancy. Goes to your team, not the tenant. Built from each tenancy's Renter's insurance list; off until you turn it on.",
    tokens: [...COMMON_TOKENS, "tenant_name", "insurance_list", "earliest_expiry", "dashboard_url"],
    defaultSubject: "Renter's insurance needs attention — {{property_address}}",
    defaultBody:
      "The renter's insurance you've logged for {{tenant_name}} at {{property_address}} needs attention:\n\n{{insurance_list}}\n\nReach out to your tenant for renewed proof of insurance before any coverage gap. An uninsured tenant can leave you exposed if there's a fire, flood, or liability claim. Please confirm the policy details on file.\n\nReview or update this tenancy's insurance: {{dashboard_url}}",
    active: true,
  },
  {
    // Lease-violation follow-up reminder (S383). The tenancy-scoped sibling of the
    // renter's-insurance reminder (landlord_insurance_lapse): fires off the logged
    // lease violations (tenancy_violations) that are still OPEN and carry a remedy
    // deadline (remedy_due_on) — anchored to that deadline (a per-record sweep,
    // app/api/cron/violation-followup), not the seasonal calendar. Default 3-day
    // lead window plus an overdue fire. Opt-in per org (isDripEnqueueEnabled) so it
    // ships dark. Goes to the operator, never the tenant.
    key: "leasing.landlord_violation_followup",
    family: "leasing",
    audience: "operator",
    label: "Lease violation follow-up due",
    description:
      "When you log a lease violation on a tenancy and give the tenant a remedy deadline, we email you as that deadline approaches — and again if it passes — so you can check whether it was fixed and then close it or escalate, before the window to act on a notice slips. One reminder per tenancy. Goes to your team, not the tenant. Built from each tenancy's Lease violations list; off until you turn it on.",
    tokens: [...COMMON_TOKENS, "tenant_name", "violation_list", "earliest_due", "dashboard_url"],
    defaultSubject: "Lease violation needs follow-up — {{property_address}}",
    defaultBody:
      "A lease violation you've logged for {{tenant_name}} at {{property_address}} has a remedy deadline that needs follow-up:\n\n{{violation_list}}\n\nCheck whether the tenant has remedied it. If they have, mark it remedied; if not, decide whether to escalate. Acting before the deadline window closes keeps your options open.\n\nReview or update this tenancy's lease violations: {{dashboard_url}}",
    active: true,
  },
  {
    // Property-inspection reminder (S385). The tenancy-scoped sibling of the
    // lease-violation follow-up reminder (landlord_violation_followup): fires off
    // the scheduled property inspections (tenancy_inspections) that are still
    // 'scheduled' and carry a planned date (scheduled_for) — anchored to that
    // date (a per-record sweep, app/api/cron/inspection-reminder), not the
    // seasonal calendar. Default 7-day lead window plus an overdue fire. Opt-in
    // per org (isDripEnqueueEnabled) so it ships dark. Goes to the operator,
    // never the tenant.
    key: "leasing.landlord_inspection_due",
    family: "leasing",
    audience: "operator",
    label: "Property inspection due",
    description:
      "Schedule your move-in, move-out, and periodic inspections on a tenancy with a planned date, and we email you about a week before — and again if the date passes — so you can give the tenant the required written notice and book a time before it slips. One reminder per tenancy. Goes to your team, not the tenant. Built from each tenancy's Inspections list; off until you turn it on.",
    tokens: [...COMMON_TOKENS, "tenant_name", "inspection_list", "earliest_due", "dashboard_url"],
    defaultSubject: "Property inspection coming up — {{property_address}}",
    defaultBody:
      "A property inspection you've scheduled for {{tenant_name}} at {{property_address}} is coming up:\n\n{{inspection_list}}\n\nGive your tenant the required written notice of entry and book a time. Once it's done, mark it completed so the record's on file for any future deposit or damage dispute.\n\nReview or update this tenancy's inspections: {{dashboard_url}}",
    active: true,
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

/** The send mode for an event (absent => "notify", the shipped default). */
export function notificationSendMode(event: NotificationEvent): NotificationSendMode {
  return event.sendMode ?? "notify";
}

/**
 * Should an `approve_to_send` (drip) event ENQUEUE a draft for this org?
 *
 * Opt-IN, unlike isEventEnabled: a drip stays dark until the org EXPLICITLY
 * turns it on (a notification_settings row with enabled=true). An absent row
 * means "no draft" — so no org starts drafting tenant comms by default, and the
 * compliance drip ships dark behind the per-org flag. (Once enabled, the draft
 * still only goes to the pending queue; a human must Approve & Send — the
 * enqueue gate is about noise/consent to draft, not about reaching the tenant.)
 */
export function isDripEnqueueEnabled(setting: NotificationSettingRow | null): boolean {
  return setting?.enabled === true;
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

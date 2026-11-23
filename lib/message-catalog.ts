// S824e: every email, text and call message Vacantless sends, in one list.
// The "Every message we send" page (app/dashboard/automations/every-message)
// reads this file, and scripts/test-s824e-message-catalog.ts fails when a send
// in the code is missing here. Add a new message here when you add its send.
//
// The 58 notification events (lib/notifications.ts) are listed by the page
// straight from their registry, with their own on/off switch and wording, so
// they are not repeated here. Everything else is below.

export type MessageGroup =
  | "renters"
  | "tenants"
  | "agents"
  | "trades"
  | "you"
  | "account"
  | "vacantless"
  | "others";

export type MessageChannel = "email" | "text" | "call";

/** Org switches this page may turn on or off by itself (plain booleans, no side effects). */
export const MESSAGE_ORG_SWITCHES = [
  "nurture_enabled",
  "feedback_enabled",
  "reschedule_nudge_enabled",
  "availability_tripwire_enabled",
  "viewing_reminder_enabled",
  "compliance_calendar_enabled",
  "viewing_times_opened_enabled",
  "rental_report_enabled",
] as const;
export type MessageOrgSwitch = (typeof MESSAGE_ORG_SWITCHES)[number];

export type MessageControl =
  /** A plain account switch, turned on or off on this page. */
  | { type: "switch"; column: MessageOrgSwitch }
  /** Set on another page; the row links there and shows the current state. */
  | { type: "elsewhere"; href: string; label: string; column?: "sms_enabled" | "auto_release_unconfirmed_enabled" }
  /** Goes out only when someone presses a button. */
  | { type: "button"; where: string }
  /** Always sent; part of how the product works. */
  | { type: "always" };

export type CatalogMessage = {
  id: string;
  group: MessageGroup;
  title: string;
  when: string;
  channels: MessageChannel[];
  /** S824f: who receives it. */
  goesTo: string;
  /** S824f: what it carries that a landlord would want to know. */
  includes?: string;
  control: MessageControl;
  /** Texts go only when the account has texting on. */
  textNeedsTexting?: boolean;
  /** Where the code sends it, for the completeness test. */
  code: { send?: string[]; sms?: string[]; notify?: string[]; voice?: string[] };
};

export const MESSAGE_GROUPS: { group: MessageGroup; label: string; hint: string }[] = [
  { group: "renters", label: "Renters", hint: "People asking about a rental, before they sign a lease." },
  { group: "tenants", label: "Tenants", hint: "People living in your rentals." },
  { group: "agents", label: "Showing agents, crew and teammates", hint: "People who run viewings or work on your units." },
  { group: "trades", label: "Trades", hint: "Contractors you send repair jobs to." },
  { group: "you", label: "You and your team", hint: "Alerts and reminders about your rentals." },
  { group: "account", label: "Your Vacantless account", hint: "Sign-in, setup and billing emails." },
  { group: "vacantless", label: "Sent to Vacantless staff", hint: "So a person can act on your request. You do not get these." },
  { group: "others", label: "Sent by other services", hint: "Not sent by Vacantless. Change these in that service." },
];

export const CATALOG_MESSAGES: CatalogMessage[] = [
  // ---- Renters -------------------------------------------------------------
  {
    id: "renter-auto-reply",
    group: "renters",
    goesTo: "The renter who wrote in.",
    includes: "Your rental page link, and an answer to their question.",
    title: "Thanks for your interest",
    when: "Right after a renter writes in without booking. It carries your rental page and answers their question when it can.",
    channels: ["email"],
    control: { type: "always" },
    code: { send: ["sendAutoReply"] },
  },
  {
    id: "renter-booking-confirmation",
    group: "renters",
    goesTo: "The renter who booked.",
    includes: "Your arrival note, who to call, a map and a photo ID line.",
    title: "Viewing booked",
    when: "Right after a viewing is booked. The renter, you or offered times can book it.",
    channels: ["email", "text"],
    textNeedsTexting: true,
    control: { type: "always" },
    code: {
      send: ["sendBookingConfirmation"],
      sms: ["app/r/[propertyId]/actions.ts", "app/dashboard/leads/[id]/book-actions.ts"],
    },
  },
  {
    id: "renter-viewing-reminders",
    group: "renters",
    goesTo: "The renter who booked.",
    includes: "Your arrival note, who to call on arrival, and a confirm link.",
    title: "Viewing reminders",
    when: "The day before, by email. A text too if they have not confirmed. About 4 hours before, a text. With texting off, an email.",
    channels: ["email", "text"],
    textNeedsTexting: true,
    control: { type: "always" },
    code: { send: ["sendShowingReminder"], sms: ["app/api/cron/reminders/route.ts"] },
  },
  {
    id: "renter-auto-released",
    group: "renters",
    goesTo: "The renter who booked.",
    title: "Viewing released",
    when: "When an unconfirmed viewing is released, ahead of its time.",
    channels: ["email"],
    control: {
      type: "elsewhere",
      href: "/dashboard/settings",
      label: "Settings, release unconfirmed viewings",
      column: "auto_release_unconfirmed_enabled",
    },
    code: { send: ["sendShowingAutoReleased"] },
  },
  {
    id: "renter-rescheduled",
    group: "renters",
    goesTo: "The renter who booked.",
    includes: "The new time, your arrival note, who to call, a map.",
    title: "Your viewing moved",
    when: "When you move a booked viewing to a new time.",
    channels: ["email"],
    control: { type: "button", where: "Viewings, move a viewing" },
    code: { send: ["sendShowingRescheduled"] },
  },
  {
    id: "renter-reschedule-proposal",
    group: "renters",
    goesTo: "The renter who booked.",
    title: "New times to pick from",
    when: "When you suggest new viewing times.",
    channels: ["email"],
    control: { type: "button", where: "Viewings, suggest new times" },
    code: { send: ["sendRescheduleProposal"] },
  },
  {
    id: "renter-reschedule-nudge",
    group: "renters",
    goesTo: "The renter who booked.",
    title: "Reminder to pick a new time",
    when: "24 hours after you suggested new times. Only if none was picked.",
    channels: ["email"],
    control: { type: "switch", column: "reschedule_nudge_enabled" },
    code: {},
  },
  {
    id: "renter-reschedule-accepted",
    group: "renters",
    goesTo: "The renter who booked.",
    includes: "The new time, your arrival note, who to call, a map.",
    title: "New time confirmed",
    when: "When the renter picks one of your suggested times.",
    channels: ["email"],
    control: { type: "always" },
    code: { send: ["sendRescheduleAcceptedConfirmation"] },
  },
  {
    id: "renter-offer-times",
    group: "renters",
    goesTo: "The renter you offered times to.",
    includes: "Up to three times. The one they tap is booked.",
    title: "Times offered to you",
    when: "When you offer a renter up to three times on their page.",
    channels: ["email"],
    control: { type: "button", where: "The renter's page, Offer times to this renter" },
    code: { send: ["sendViewingOffer"] },
  },
  {
    id: "renter-feedback",
    group: "renters",
    goesTo: "The renter who came to the viewing.",
    title: "How was your viewing?",
    when: "A few hours after a viewing, 2 hours unless you change it.",
    channels: ["email"],
    control: { type: "switch", column: "feedback_enabled" },
    code: { send: ["sendFeedbackRequest"] },
  },
  {
    id: "renter-follow-ups",
    group: "renters",
    goesTo: "The renter who wrote in.",
    title: "Follow-ups to quiet renters",
    when: "Day 2 and day 5 after they wrote in. Only if not booked.",
    channels: ["email"],
    control: { type: "switch", column: "nurture_enabled" },
    code: { send: ["sendNurtureEmail"] },
  },
  {
    id: "renter-times-opened",
    group: "renters",
    goesTo: "Renters who found no time that worked.",
    title: "New viewing times are open",
    when: "When you open times for a renter who found none that worked. Never at night.",
    channels: ["email", "text"],
    textNeedsTexting: true,
    control: { type: "switch", column: "viewing_times_opened_enabled" },
    code: { send: ["sendViewingTimesOpenedEmail"], sms: ["lib/availability-reopen-sms.ts"] },
  },
  {
    id: "renter-rented",
    group: "renters",
    goesTo: "Renters still waiting on that rental.",
    title: "This one rented, here are the others",
    when: "When you mark a rental rented, to renters still waiting on it.",
    channels: ["email"],
    control: { type: "always" },
    code: { send: ["sendRentedNoticeEmail"] },
  },
  {
    id: "renter-price-drop",
    group: "renters",
    goesTo: "Renters who asked about that rental.",
    title: "Price drop",
    when: "When you lower the rent and choose to tell renters who asked.",
    channels: ["email"],
    control: { type: "button", where: "Rental page, lower the rent" },
    code: { send: ["sendPriceDropAlert"] },
  },
  {
    id: "renter-waitlist",
    group: "renters",
    goesTo: "Renters on that waitlist.",
    title: "A unit opened up",
    when: "When you tell your waitlist about a vacancy.",
    channels: ["email", "text"],
    textNeedsTexting: true,
    control: { type: "button", where: "Rental page, waitlist" },
    code: { send: ["sendWaitlistVacancyAlert"], sms: ["app/dashboard/properties/[id]/waitlist-actions.ts"] },
  },
  {
    id: "renter-application",
    group: "renters",
    goesTo: "The renter you picked.",
    title: "Rental application link",
    when: "When you send a renter your application form.",
    channels: ["email"],
    control: { type: "button", where: "The renter's page, Application and offer" },
    code: { send: ["sendRentalApplicationInvite"] },
  },
  {
    id: "renter-credit-check",
    group: "renters",
    goesTo: "The renter you picked.",
    title: "Credit check link",
    when: "When you ask a renter for a credit check.",
    channels: ["email"],
    control: { type: "button", where: "The renter's page, Application and offer" },
    code: { send: ["sendCreditCheckInvite"] },
  },
  {
    id: "renter-offer",
    group: "renters",
    goesTo: "The renter you picked.",
    title: "Your offer",
    when: "When you send a renter an offer to rent.",
    channels: ["email"],
    control: { type: "button", where: "The renter's page, Application and offer" },
    code: { send: ["sendApplicationOfferInvite"] },
  },
  {
    id: "renter-text",
    group: "renters",
    goesTo: "The renter you picked.",
    title: "Your text to a renter",
    when: "When you type and send a text on a renter's page.",
    channels: ["text"],
    textNeedsTexting: true,
    control: { type: "button", where: "The renter's page, Text this renter" },
    code: { sms: ["app/dashboard/leads/actions.ts"] },
  },
  {
    id: "renter-missed-call-text",
    group: "renters",
    goesTo: "Whoever left a voicemail on your texting number.",
    title: "Text back after a voicemail",
    when: "After a caller leaves a voicemail. It carries your booking link. Never at night.",
    channels: ["text"],
    textNeedsTexting: true,
    control: { type: "always" },
    code: { sms: ["lib/ai-enquiry-ingest.ts"] },
  },
  {
    id: "caller-voice",
    group: "renters",
    goesTo: "Whoever calls your texting number.",
    title: "Answer to a phone call",
    when: "When anyone calls your texting number. A short message says to text instead.",
    channels: ["call"],
    textNeedsTexting: true,
    control: { type: "always" },
    code: { voice: ["app/api/sms/voice/route.ts"] },
  },

  // ---- Tenants -------------------------------------------------------------
  {
    id: "tenant-messages",
    group: "tenants",
    goesTo: "The tenants you pick.",
    title: "Your notes to tenants",
    when: "When you send one, or on the date you scheduled it.",
    channels: ["email", "text"],
    textNeedsTexting: true,
    control: { type: "button", where: "Tenants, messages" },
    code: {
      send: ["sendTenantMessageEmail"],
      sms: ["lib/tenant-comms-dispatch.ts"],
      notify: ["app/dashboard/messages/actions.ts"],
    },
  },
  {
    id: "tenant-lease-signature",
    group: "tenants",
    goesTo: "The tenants on that lease.",
    title: "Sign your lease",
    when: "When you send a lease for signing.",
    channels: ["email"],
    control: { type: "button", where: "The rented unit's page, lease" },
    code: { send: ["sendLeaseSignatureRequest"] },
  },
  {
    id: "tenant-repair-reminder-text",
    group: "tenants",
    goesTo: "The tenant who asked for the repair.",
    title: "Repair visit reminder by text",
    when: "The day before and the same day as a confirmed repair visit. The email part is the repair visit reminder below.",
    channels: ["text"],
    textNeedsTexting: true,
    control: { type: "always" },
    code: { sms: ["app/api/cron/appointment-reminder/route.ts"] },
  },
  {
    id: "tenant-repair-text-reply",
    group: "tenants",
    goesTo: "The tenant who texted.",
    includes: "A link to add photos and details.",
    title: "We got your repair request",
    when: "Right after a tenant texts in a repair.",
    channels: ["text"],
    textNeedsTexting: true,
    control: { type: "always" },
    code: { sms: ["lib/text-in-repairs-server.ts"] },
  },

  // ---- Showing agents, crew and teammates ----------------------------------
  {
    id: "team-invite",
    group: "agents",
    goesTo: "The person you invite.",
    title: "Join the team",
    when: "When you invite someone to your account. A setup invite also lists the two tools to set up.",
    channels: ["email"],
    control: { type: "button", where: "Settings, team" },
    code: { send: ["sendTeamInvite"] },
  },

  // ---- Trades ---------------------------------------------------------------
  {
    id: "trade-dispatch",
    group: "trades",
    goesTo: "The trade you pick.",
    title: "New job for you",
    when: "When you send a repair job to a trade.",
    channels: ["email"],
    control: { type: "button", where: "Repairs, send to a trade" },
    code: { send: ["sendTradeDispatchInvite"] },
  },

  // ---- You and your team ----------------------------------------------------
  {
    id: "you-emergency-text",
    group: "you",
    goesTo: "The rental's emergency phone, else your account's.",
    title: "Emergency repair text",
    when: "Right after a tenant reports an emergency, to your emergency phone.",
    channels: ["text"],
    textNeedsTexting: true,
    control: { type: "always" },
    code: { sms: ["lib/incident-notify-server.ts"] },
  },
  {
    id: "you-incident-report",
    group: "you",
    goesTo: "Your team members who handle repairs.",
    title: "A tenant filed a report",
    when: "Right after a tenant sends a report.",
    channels: ["email"],
    control: { type: "always" },
    code: { send: ["sendIncidentReportNotification"] },
  },
  {
    id: "you-site-mail",
    group: "you",
    goesTo: "Account owners and admins.",
    title: "Emails from your rental site accounts",
    when: "When Kijiji, Rentals.ca or Zumper emails your account. Codes and sign-up links go to owners and admins.",
    channels: ["email"],
    control: { type: "always" },
    code: { send: ["sendSiteMailCopy"] },
  },
  {
    id: "you-posted-results",
    group: "you",
    goesTo: "Account owners and admins.",
    title: "Where your ads are live",
    when: "Two hours after a rental's first ad goes live, once per vacancy.",
    channels: ["email"],
    control: { type: "always" },
    code: { notify: ["app/api/cron/posted-results-email/route.ts"] },
  },
  {
    id: "you-rental-report",
    group: "you",
    goesTo: "Account owners and admins, plus anyone under Also send to.",
    title: "Monthly report for each rental",
    when: "The 1st of each month, for each rental that is advertised. Send now on a rental sends it to you only.",
    includes: "Latest work and your next steps. Renters by site and viewings. Each site, its link and cost.",
    channels: ["email"],
    control: { type: "switch", column: "rental_report_enabled" },
    code: { send: ["sendRentalReportEmail"] },
  },
  {
    id: "you-checkout-ready",
    group: "you",
    goesTo: "Account owners and admins.",
    title: "A paid ad is ready to pay",
    when: "The moment a paid ad waits at a site's checkout. Once more after 4 hours if unpaid.",
    channels: ["email"],
    control: { type: "always" },
    code: { notify: ["app/api/cron/checkout-ready/route.ts"] },
  },
  {
    id: "you-rent-failed",
    group: "you",
    goesTo: "Account owners and admins.",
    title: "A rent payment did not go through",
    when: "When a tenant's monthly bank debit on Stripe fails.",
    channels: ["email"],
    control: { type: "always" },
    code: { notify: ["lib/rent-failed-notify.ts"] },
  },
  {
    id: "you-signin-lost",
    group: "you",
    goesTo: "Account owners and admins.",
    title: "A rental site signed you out",
    when: "Once, when Kijiji, Zumper or Rentals.ca signs out the robot. A text too on Growth with your mobile saved.",
    channels: ["email", "text"],
    textNeedsTexting: true,
    control: { type: "always" },
    code: { notify: ["app/api/cron/signin-lost/route.ts"], sms: ["app/api/cron/signin-lost/route.ts"] },
  },
  {
    id: "you-marketplace-phone",
    group: "you",
    goesTo: "You, the person who pressed it.",
    title: "Your Marketplace ad, for your phone",
    when: "When you press Email it to me on a rental's Marketplace kit.",
    channels: ["email"],
    control: { type: "button", where: "Rental page, Marketplace kit" },
    code: { notify: ["app/dashboard/properties/[id]/marketplace-actions.ts"] },
  },
  {
    id: "you-sites-computer",
    group: "you",
    goesTo: "You, the person who pressed it.",
    title: "Finish this on your computer",
    when: "When you send a site step to your computer.",
    channels: ["email"],
    control: { type: "button", where: "Rental sites" },
    code: { notify: ["app/dashboard/sites/actions.ts"] },
  },
  {
    id: "you-sender-confirm",
    group: "you",
    goesTo: "The address you added.",
    title: "Confirm a forwarding address",
    when: "When you add an address that forwards renter emails to Vacantless.",
    channels: ["email"],
    control: { type: "button", where: "Renter emails" },
    code: { send: ["sendSenderConfirmation"] },
  },
  {
    id: "you-test-email",
    group: "you",
    goesTo: "You, the person who pressed it.",
    title: "Test email",
    when: "When you press Send a test email.",
    channels: ["email"],
    control: { type: "button", where: "Settings, emails" },
    code: { send: ["sendTestEmail"] },
  },

  // ---- Your Vacantless account ----------------------------------------------
  {
    id: "account-welcome",
    group: "account",
    goesTo: "The person who signed up.",
    title: "Welcome, and one step to your first booking or to collecting rent",
    when: "At sign-up. Then once the next day, if setup is not done. Signed up to collect rent: the rent version.",
    channels: ["email"],
    control: { type: "always" },
    code: { notify: ["lib/onboarding-email-send.ts"] },
  },
  {
    id: "account-texting-on",
    group: "account",
    goesTo: "Account owners and admins.",
    title: "Your texting number is on",
    when: "Once, when your texting number is ready.",
    channels: ["email"],
    control: { type: "always" },
    code: { notify: ["lib/texting-numbers-server.ts"] },
  },
  {
    id: "account-founding",
    group: "account",
    goesTo: "The billing email on your account.",
    title: "Your founding free time ends soon",
    when: "A few days before a founding free period ends.",
    channels: ["email"],
    control: { type: "always" },
    code: { notify: ["app/api/cron/founding-trial/route.ts"] },
  },
  {
    id: "account-tips",
    group: "account",
    goesTo: "Account owners.",
    title: "Tips for landlords with tenants",
    when: "Off for every account today. When on, one tip at a time for Free accounts with tenants.",
    channels: ["email"],
    control: { type: "always" },
    code: { send: ["sendLandlordRentConfirmEmail"], notify: ["app/api/cron/landlord-campaign/route.ts"] },
  },
  {
    id: "account-signin",
    group: "account",
    goesTo: "The person signing in.",
    title: "Sign-in emails",
    when: "When you sign up, reset a password or ask for a sign-in link.",
    channels: ["email"],
    control: { type: "always" },
    code: {},
  },

  // ---- Sent to Vacantless staff ---------------------------------------------
  {
    id: "staff-requests",
    group: "vacantless",
    goesTo: "Vacantless staff.",
    title: "Your requests to us",
    when: "When you ask us for an alias or brokerage help. Also when you close your account.",
    channels: ["email"],
    control: { type: "always" },
    code: { notify: ["app/dashboard/settings/actions.ts", "app/dashboard/properties/[id]/brokerage-actions.ts"] },
  },
  {
    id: "staff-checks",
    group: "vacantless",
    goesTo: "Vacantless staff.",
    title: "Our daily checks",
    when: "Each morning, and when a background job or texting setup fails.",
    channels: ["email"],
    control: { type: "always" },
    code: {
      notify: [
        "app/api/cron/health-digest/route.ts",
        "app/api/cron/new-account-watch/route.ts",
        "app/api/cron/sweep-all/route.ts",
      ],
    },
  },

  // ---- Sent by other services ------------------------------------------------
  {
    id: "others-payments",
    group: "others",
    goesTo: "Your tenants and you.",
    title: "Rent and billing receipts",
    when: "Stripe and Rotessa email your tenants and you about payments.",
    channels: ["email"],
    control: { type: "always" },
    code: {},
  },
  {
    id: "others-sites",
    group: "others",
    goesTo: "You.",
    title: "Rental sites and Buildium",
    when: "Kijiji, Rentals.ca, Zumper, Facebook and Buildium send their own emails.",
    channels: ["email"],
    control: { type: "always" },
    code: {},
  },
];

/** Notification events sent to agents or crew, shown in that group, not "You". */
export const AGENT_EVENT_KEYS = new Set<string>([
  "leasing.showing_assigned",
  "leasing.marketplace_kit",
  "leasing.showing_rescheduled",
  "leasing.showing_unconfirmed_nudge",
  "leasing.crew_progress_reminder",
]);

/** Notification events drafted for you to review; they never send by themselves. */
export function isDraftOnlyEvent(key: string): boolean {
  return key.startsWith("leasing.seasonal_") || key === "leasing.rent_increase_tenant_notice";
}

export function eventGroup(e: { key: string; audience: "operator" | "tenant" | "trade" }): MessageGroup {
  if (AGENT_EVENT_KEYS.has(e.key)) return "agents";
  if (e.audience === "tenant") return "tenants";
  if (e.audience === "trade") return "trades";
  return "you";
}

export function channelLabel(channels: MessageChannel[]): string {
  const words = channels.map((c) => (c === "email" ? "Email" : c === "text" ? "Text" : "Call"));
  return words.join(" and ");
}

/** The ids are unique and every message names its group. Pure; used by the test. */
export function catalogProblems(list: CatalogMessage[] = CATALOG_MESSAGES): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const groups = new Set(MESSAGE_GROUPS.map((g) => g.group));
  for (const m of list) {
    if (seen.has(m.id)) out.push(`duplicate id ${m.id}`);
    seen.add(m.id);
    if (!groups.has(m.group)) out.push(`${m.id}: unknown group`);
    if (!m.when.trim() || !m.title.trim()) out.push(`${m.id}: empty title or when`);
    if (m.channels.length === 0) out.push(`${m.id}: no way to send`);
    if (!m.goesTo.trim()) out.push(`${m.id}: no recipient`);
  }
  return out;
}

/** Events that stay off until the account turns them on (no row means off). */
export const OPT_IN_EVENT_KEYS = new Set<string>(["leasing.listing_health"]);

/**
 * Is this notification event on for the account? Same rules as the senders:
 * most events are on with no row; drafts (approve_to_send) and listing health
 * are on only with an explicit row (lib/notifications isDripEnqueueEnabled).
 */
export function eventIsOn(
  e: { key: string; sendMode?: string },
  row: { enabled: boolean } | null | undefined,
): boolean {
  if (OPT_IN_EVENT_KEYS.has(e.key) || e.sendMode === "approve_to_send") return row?.enabled === true;
  return row ? row.enabled : true;
}

/** S824f: who gets a notification event, by its audience. */
export function eventGoesTo(e: { key: string; audience: "operator" | "tenant" | "trade" }): string {
  if (AGENT_EVENT_KEYS.has(e.key)) {
    return e.key === "leasing.crew_progress_reminder" ? "The crew member asked about the unit." : "The assigned showing agent.";
  }
  if (e.audience === "tenant") return "The tenant, plus anyone you add on its card.";
  if (e.audience === "trade") return "The trade on the job, plus anyone you add.";
  return "Your team, or the addresses on its card.";
}

/** S824f: what an event carries, where it matters. */
export const EVENT_INCLUDES: Record<string, string> = {
  "leasing.showing_assigned": "A link to their viewings page with your access instructions.",
  "leasing.showing_rescheduled": "The new time and a link to their viewings page.",
};

/** S824j: alerts that take extra addresses on Every message we send (migration 0317). */
export const EXTRA_RECIPIENT_MESSAGE_IDS = [
  "you-posted-results",
  "you-signin-lost",
  "you-site-mail",
  "you-incident-report",
  "you-rental-report",
] as const;
export type ExtraRecipientMessageId = (typeof EXTRA_RECIPIENT_MESSAGE_IDS)[number];

/** S824j: rows whose phone number is set on another page. */
export const PHONE_LINKS: Record<string, { href: string; label: string }> = {
  "renter-booking-confirmation": { href: "/dashboard/settings?tab=comms", label: "Change the arrival phone" },
  "renter-viewing-reminders": { href: "/dashboard/settings?tab=comms", label: "Change the arrival phone" },
  "you-emergency-text": { href: "/dashboard/maintenance", label: "Change the emergency phone" },
};

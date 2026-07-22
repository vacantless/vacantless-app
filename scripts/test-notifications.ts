// Unit tests for the pure notifications domain model (Slice 6 substrate, S327).
// Run: npx tsx scripts/test-notifications.ts
import {
  NOTIFICATION_EVENTS,
  isNotificationEventKey,
  getNotificationEvent,
  activeNotificationEvents,
  notificationFamilyLabel,
  renderNotification,
  isEventEnabled,
  notificationSendMode,
  isDripEnqueueEnabled,
  isValidEmail,
  parseRecipientList,
  validateRecipientsInput,
  resolveNotificationRecipients,
  formatQuoteToken,
  firstWord,
  tradeUpdateStatusLabel,
  tradeUpdateDetail,
  normalizeAccentColor,
  resolveNotificationAccent,
  MAX_NOTIFICATION_RECIPIENTS,
  type NotificationSettingRow,
} from "../lib/notifications";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- registry ---------------------------------------------------------------
ok("events: at least 5", NOTIFICATION_EVENTS.length >= 5);
ok("events: keys unique", new Set(NOTIFICATION_EVENTS.map((e) => e.key)).size === NOTIFICATION_EVENTS.length);
ok("events: all dispatch active", NOTIFICATION_EVENTS.filter((e) => e.family === "dispatch").every((e) => e.active));
ok("isKey: known", isNotificationEventKey("dispatch.scheduled.tenant"));
ok("isKey: unknown", !isNotificationEventKey("nope.nope"));
ok("getEvent: known", getNotificationEvent("dispatch.trade_update")?.audience === "operator");
ok("getEvent: unknown null", getNotificationEvent("zzz") === null);
ok("active: all active here", activeNotificationEvents().length === NOTIFICATION_EVENTS.length);
ok("family label dispatch", notificationFamilyLabel("dispatch") === "Maintenance dispatch");
ok(
  "events: every default has tokens present in its token list",
  NOTIFICATION_EVENTS.every((e) => {
    const used = [...e.defaultSubject.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1]);
    const usedBody = [...e.defaultBody.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[1]);
    return [...used, ...usedBody].every((t) => (e.tokens as readonly string[]).includes(t));
  }),
);

// --- render: default vs override + token substitution -----------------------
const ev = getNotificationEvent("dispatch.scheduled.tenant")!;
const vars = {
  org_name: "Agile",
  property_address: "833 Pillette Rd — Unit 22",
  tenant_first_name: "Nya",
  job_title: "Leaky faucet",
  scheduled_date: "Thu Jun 25, 2026",
};
const rDefault = renderNotification(ev, null, vars);
ok("render: default subject substitutes date", rDefault.subject.includes("Thu Jun 25, 2026"));
ok("render: default body greets tenant", rDefault.body.includes("Hi Nya,"));
ok("render: default body has address", rDefault.body.includes("833 Pillette Rd — Unit 22"));

const overrideRow: NotificationSettingRow = {
  event_key: ev.key,
  enabled: true,
  subject_template: "Booked {{scheduled_date}}",
  body_template: "Yo {{tenant_first_name}}",
  recipients: null,
  accent_color: null,
};
const rOver = renderNotification(ev, overrideRow, vars);
ok("render: override subject wins", rOver.subject === "Booked Thu Jun 25, 2026");
ok("render: override body wins", rOver.body === "Yo Nya");

// blank override falls back to default
const blankRow: NotificationSettingRow = {
  event_key: ev.key,
  enabled: true,
  subject_template: "   ",
  body_template: "",
  recipients: null,
  accent_color: null,
};
ok("render: blank override -> default", renderNotification(ev, blankRow, vars).subject.includes("scheduled for"));

// unknown token left intact
ok(
  "render: unknown token preserved",
  renderNotification(ev, { ...overrideRow, subject_template: "{{mystery}}" }, vars).subject === "{{mystery}}",
);

// --- enabled ----------------------------------------------------------------
ok("enabled: absent row -> on", isEventEnabled(null));
ok("enabled: row off -> off", !isEventEnabled({ ...overrideRow, enabled: false }));

// --- send mode (S341) -------------------------------------------------------
ok("sendMode: default is notify", notificationSendMode(getNotificationEvent("leasing.new_lead")!) === "notify");
ok("sendMode: rent-increase notify", notificationSendMode(getNotificationEvent("leasing.rent_increase")!) === "notify");
ok(
  "sendMode: tenant-notice is approve_to_send",
  notificationSendMode(getNotificationEvent("leasing.rent_increase_tenant_notice")!) === "approve_to_send",
);
ok(
  "sendMode: every approve_to_send event is tenant-audience",
  NOTIFICATION_EVENTS.filter((e) => notificationSendMode(e) === "approve_to_send").every((e) => e.audience === "tenant"),
);
ok(
  "sendMode: tenant-notice event registered + active",
  getNotificationEvent("leasing.rent_increase_tenant_notice")?.active === true,
);
// drip enqueue is OPT-IN (explicit enabled override), unlike isEventEnabled
ok("drip: absent row -> NO enqueue", !isDripEnqueueEnabled(null));
ok("drip: enabled=false -> NO enqueue", !isDripEnqueueEnabled({ ...overrideRow, enabled: false }));
ok("drip: enabled=true -> enqueue", isDripEnqueueEnabled({ ...overrideRow, enabled: true }));
ok("enabled: row on -> on", isEventEnabled({ ...overrideRow, enabled: true }));

// --- email validity + parsing -----------------------------------------------
ok("email: valid", isValidEmail("a@b.co"));
ok("email: no domain", !isValidEmail("a@b"));
ok("email: spaces", !isValidEmail("a b@c.com"));
ok("parse: splits + dedupes + lowercases", JSON.stringify(parseRecipientList("A@x.com, a@x.com\nb@y.com; ")) === JSON.stringify(["a@x.com", "b@y.com"]));
ok("parse: drops junk for send", JSON.stringify(parseRecipientList("good@x.com, junk")) === JSON.stringify(["good@x.com"]));
ok("parse: empty", parseRecipientList("").length === 0 && parseRecipientList(null).length === 0);

// --- validate (settings save) -----------------------------------------------
const vEmpty = validateRecipientsInput("");
ok("validate: empty ok", vEmpty.ok && vEmpty.value.length === 0);
const vGood = validateRecipientsInput("rentals@agileonline.ca\npeterszummer@gmail.com");
ok("validate: good two", vGood.ok && vGood.value.length === 2);
const vBad = validateRecipientsInput("ok@x.com, notanemail");
ok("validate: surfaces invalid", !vBad.ok && vBad.code === "bad_email" && vBad.invalid.includes("notanemail"));
const vMany = validateRecipientsInput(Array.from({ length: MAX_NOTIFICATION_RECIPIENTS + 1 }, (_, i) => `u${i}@x.com`).join("\n"));
ok("validate: too many", !vMany.ok && vMany.code === "too_many");

// --- recipient resolution ---------------------------------------------------
// operator event: configured list wins
ok(
  "resolve: operator uses configured",
  JSON.stringify(
    resolveNotificationRecipients({ audience: "operator", configured: ["a@x.com"], operatorFallback: ["fb@x.com"] }),
  ) === JSON.stringify(["a@x.com"]),
);
// operator event: empty -> fallback (never silent)
ok(
  "resolve: operator falls back",
  JSON.stringify(
    resolveNotificationRecipients({ audience: "operator", configured: [], operatorFallback: ["fb@x.com"] }),
  ) === JSON.stringify(["fb@x.com"]),
);
// operator event: the natural party (audienceEmail) is ALWAYS included, even when
// configured CCs are present (S436 Codex P1b - the assigned showing agent must
// never be dropped when an org adds an oversight CC).
ok(
  "resolve: operator always includes audienceEmail + additive cc",
  JSON.stringify(
    resolveNotificationRecipients({
      audience: "operator",
      configured: ["cc@x.com"],
      audienceEmail: "Agent@x.com",
    }),
  ) === JSON.stringify(["agent@x.com", "cc@x.com"]),
);
{
  const recipients = resolveNotificationRecipients({
    audience: "operator",
    configured: [
      "admin@x.com",
      ...Array.from({ length: MAX_NOTIFICATION_RECIPIENTS + 2 }, (_, i) => `u${i}@x.com`),
    ],
    alwaysInclude: ["Admin@x.com"],
  });
  ok(
    "resolve: operator alwaysInclude survives configured list + cap",
    recipients[0] === "admin@x.com" &&
      recipients.filter((e) => e === "admin@x.com").length === 1 &&
      recipients[1] === "u0@x.com" &&
      recipients.length === MAX_NOTIFICATION_RECIPIENTS &&
      !recipients.includes(`u${MAX_NOTIFICATION_RECIPIENTS - 1}@x.com`),
  );
}
// trade event: natural party always included + additive cc, de-duped
ok(
  "resolve: trade includes party + cc",
  JSON.stringify(
    resolveNotificationRecipients({ audience: "trade", configured: ["cc@x.com", "trade@x.com"], audienceEmail: "Trade@x.com" }),
  ) === JSON.stringify(["trade@x.com", "cc@x.com"]),
);
// tenant event: no party email + no cc -> empty (caller skips send)
ok(
  "resolve: tenant empty when nothing",
  resolveNotificationRecipients({ audience: "tenant", configured: [], audienceEmail: null }).length === 0,
);
// cap
ok(
  "resolve: caps at max",
  resolveNotificationRecipients({
    audience: "operator",
    configured: Array.from({ length: 50 }, (_, i) => `u${i}@x.com`),
  }).length === MAX_NOTIFICATION_RECIPIENTS,
);

// --- operator lane routing (S554) -------------------------------------------
// laneRecipients is the NEW middle tier for operator events: used when the
// per-event override (configured) is empty, and it wins over operatorFallback.
ok(
  "lane: used when configured empty",
  JSON.stringify(
    resolveNotificationRecipients({
      audience: "operator",
      configured: [],
      laneRecipients: ["lane@x.com"],
      operatorFallback: ["fb@x.com"],
    }),
  ) === JSON.stringify(["lane@x.com"]),
);
// per-event override still WINS over the lane
ok(
  "lane: configured wins over lane",
  JSON.stringify(
    resolveNotificationRecipients({
      audience: "operator",
      configured: ["cfg@x.com"],
      laneRecipients: ["lane@x.com"],
      operatorFallback: ["fb@x.com"],
    }),
  ) === JSON.stringify(["cfg@x.com"]),
);
// lane wins over the capability-member default
ok(
  "lane: lane wins over operatorFallback",
  JSON.stringify(
    resolveNotificationRecipients({
      audience: "operator",
      configured: [],
      laneRecipients: ["lane@x.com"],
      operatorFallback: ["fb@x.com"],
    }),
  ) === JSON.stringify(["lane@x.com"]),
);
// empty lane -> straight through to the fallback (byte-identical to pre-lane)
ok(
  "lane: empty lane falls through to fallback",
  JSON.stringify(
    resolveNotificationRecipients({
      audience: "operator",
      configured: [],
      laneRecipients: [],
      operatorFallback: ["fb@x.com"],
    }),
  ) === JSON.stringify(["fb@x.com"]),
);
// audienceEmail + alwaysInclude are still forced in FIRST, ahead of lane
// recipients, and dedupe holds.
ok(
  "lane: audienceEmail + alwaysInclude precede lane, dedupe holds",
  JSON.stringify(
    resolveNotificationRecipients({
      audience: "operator",
      configured: [],
      audienceEmail: "Agent@x.com",
      alwaysInclude: ["safety@x.com", "agent@x.com"],
      laneRecipients: ["lane@x.com", "safety@x.com"],
      operatorFallback: ["fb@x.com"],
    }),
  ) === JSON.stringify(["agent@x.com", "safety@x.com", "lane@x.com"]),
);
// tenant/trade audience ignores laneRecipients entirely
ok(
  "lane: tenant ignores laneRecipients",
  resolveNotificationRecipients({
    audience: "tenant",
    configured: [],
    audienceEmail: null,
    laneRecipients: ["lane@x.com"],
  }).length === 0,
);
ok(
  "lane: trade ignores laneRecipients",
  JSON.stringify(
    resolveNotificationRecipients({
      audience: "trade",
      configured: ["cc@x.com"],
      audienceEmail: "Trade@x.com",
      laneRecipients: ["lane@x.com"],
    }),
  ) === JSON.stringify(["trade@x.com", "cc@x.com"]),
);

// --- lane registry invariants (the guard that kills the S548b class of bug) --
// EVERY operator `leasing` event MUST declare a lane, so a new event can never
// silently default into the showing lane again. Fails loudly, naming offenders.
{
  const offenders = NOTIFICATION_EVENTS.filter(
    (e) => e.audience === "operator" && e.family === "leasing" && !e.lane,
  ).map((e) => e.key);
  if (offenders.length > 0) {
    console.error(`  ✗ lane invariant: operator leasing events missing a lane: ${offenders.join(", ")}`);
  }
  ok("lane: every operator leasing event declares a lane", offenders.length === 0);
}
// Lanes only ever appear on operator leasing events, and only with valid values.
ok(
  "lane: only operator leasing events carry a lane",
  NOTIFICATION_EVENTS.filter((e) => e.lane).every(
    (e) => e.audience === "operator" && e.family === "leasing",
  ),
);
ok(
  "lane: all lane values are valid",
  NOTIFICATION_EVENTS.filter((e) => e.lane).every((e) =>
    ["listing", "showing", "owner"].includes(e.lane as string),
  ),
);
// Spot-check the classification on one event per lane.
ok("lane: new_lead is showing", getNotificationEvent("leasing.new_lead")?.lane === "showing");
ok(
  "lane: distribution_job_needs_action is listing",
  getNotificationEvent("leasing.distribution_job_needs_action")?.lane === "listing",
);
ok("lane: rent_increase is owner", getNotificationEvent("leasing.rent_increase")?.lane === "owner");
// Tenant/dispatch events never get a lane.
ok(
  "lane: tenant compliance event has no lane",
  getNotificationEvent("leasing.rent_increase_tenant_notice")?.lane === undefined,
);
ok(
  "lane: dispatch event has no lane",
  getNotificationEvent("dispatch.trade_update")?.lane === undefined,
);

// --- quote token + helpers --------------------------------------------------
ok("quote token: cents", formatQuoteToken(25000) === "$250.00");
ok("quote token: null empty", formatQuoteToken(null) === "");
ok("firstWord: name", firstWord("Karen Mary Kenney") === "Karen");
ok("firstWord: empty -> there", firstWord(null) === "there");

// --- operator trade_update copy --------------------------------------------
ok("status label accepted", tradeUpdateStatusLabel("accepted") === "accepted the job");
ok("status label quoted", tradeUpdateStatusLabel("quoted") === "sent a quote");
ok("detail: quote with amount", tradeUpdateDetail("quoted", { quoteCents: 25000 }).includes("$250.00"));
ok("detail: quote with note", tradeUpdateDetail("quoted", { quoteCents: 25000, note: "parts extra" }).includes("parts extra"));
ok("detail: decline reason", tradeUpdateDetail("declined", { declineReason: "too far" }).includes("too far"));
ok("detail: decline no reason", /no reason/i.test(tradeUpdateDetail("declined", {})));

// --- leasing.new_lead event (first teardown event) -------------------------
{
  const ev = getNotificationEvent("leasing.new_lead");
  ok("new_lead: registered", ev !== null);
  ok("new_lead: leasing family", ev?.family === "leasing");
  ok("new_lead: operator audience", ev?.audience === "operator");
  ok("new_lead: active", ev?.active === true);
  ok("new_lead: in active set", activeNotificationEvents().some((e) => e.key === "leasing.new_lead"));
  ok("new_lead: leasing family label", notificationFamilyLabel("leasing") === "Leasing");
  // Every {{token}} in the default templates must be a declared token, else it
  // renders as a literal. (The trigger always supplies each declared token.)
  if (ev) {
    const declared = new Set(ev.tokens);
    const used = [...(ev.defaultSubject + " " + ev.defaultBody).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map(
      (m) => m[1].toLowerCase(),
    );
    ok("new_lead: all template tokens declared", used.every((t) => declared.has(t)));
    ok("new_lead: declares screening token", declared.has("screening"));
    ok("new_lead: declares no suitable time note", declared.has("no_suitable_time_note"));
    // Calmer default (post-S402): no alarmist emoji, no forced red accent — the
    // stripe falls back to the org brand color unless the landlord picks red.
    ok("new_lead: subject has no alert emoji", !ev.defaultSubject.includes("🔴"));
    ok("new_lead: subject reads as a plain new-inquiry line", ev.defaultSubject.startsWith("New inquiry from"));
    ok("new_lead: no forced default accent", ev.defaultAccent === undefined);
    // Fully-supplied render (incl. a populated screening block) leaves no literal
    // {{...}} behind and inlines the screening text.
    const rendered = renderNotification(ev, null, {
      org_name: "Agile",
      property_address: "833 Pillette Rd — Unit 20",
      lead_name: "Karen Kenney",
      lead_email: "karen@example.com",
      lead_phone: "519-555-0100",
      move_in: "2026-08-01",
      no_suitable_time_note:
        "⚠ This renter couldn't find a workable viewing time — offer alternate times.",
      screening: "Screening\nOccupants: 3\nEmployment: Employed full-time",
      dashboard_url: "https://x/dashboard/leads/abc",
    });
    ok("new_lead: renders name", rendered.body.includes("Karen Kenney"));
    ok("new_lead: renders address in subject", rendered.subject.includes("833 Pillette"));
    ok(
      "new_lead: renders no suitable time note",
      rendered.body.includes("couldn't find a workable viewing time"),
    );
    ok("new_lead: inlines screening", rendered.body.includes("Employment: Employed full-time"));
    ok("new_lead: no leftover tokens", !/\{\{/.test(rendered.subject + rendered.body));
    // Empty screening collapses cleanly (no orphan label, no literal token).
    const renderedEmpty = renderNotification(ev, null, {
      org_name: "Agile",
      property_address: "833 Pillette Rd — Unit 20",
      lead_name: "Karen Kenney",
      lead_email: "karen@example.com",
      lead_phone: "519-555-0100",
      move_in: "2026-08-01",
      no_suitable_time_note: "",
      screening: "",
      dashboard_url: "https://x/dashboard/leads/abc",
    });
    ok("new_lead: empty screening leaves no token", !/\{\{/.test(renderedEmpty.body));
  }
}

// --- leasing.viewing_booked event (S490) -----------------------------------
{
  const ev = getNotificationEvent("leasing.viewing_booked");
  ok("viewing_booked: registered", ev !== null);
  ok("viewing_booked: leasing family", ev?.family === "leasing");
  ok("viewing_booked: operator audience", ev?.audience === "operator");
  ok("viewing_booked: active", ev?.active === true);
  ok("viewing_booked: in active set", activeNotificationEvents().some((e) => e.key === "leasing.viewing_booked"));
  ok("viewing_booked: informational accent", ev?.defaultAccent === undefined);
  if (ev) {
    const declared = new Set(ev.tokens);
    const used = [...(ev.defaultSubject + " " + ev.defaultBody).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map(
      (m) => m[1].toLowerCase(),
    );
    ok("viewing_booked: all template tokens declared", used.every((t) => declared.has(t)));
    ok("viewing_booked: declares phone", declared.has("lead_phone"));
    ok("viewing_booked: declares showing time", declared.has("showing_time"));
    const rendered = renderNotification(ev, null, {
      org_name: "Agile",
      property_address: "833 Pillette Rd - Unit 20",
      lead_name: "Gurpreet Singh",
      lead_phone: "519-555-0100",
      showing_time: "Tue, Jul 14, 5:30 PM EDT",
      dashboard_url: "https://x/dashboard/leads/abc",
    });
    ok("viewing_booked: renders lead name", rendered.subject.includes("Gurpreet Singh"));
    ok("viewing_booked: renders showing time", rendered.subject.includes("5:30 PM"));
    ok("viewing_booked: renders phone", rendered.body.includes("519-555-0100"));
    ok("viewing_booked: no leftover tokens", !/\{\{/.test(rendered.subject + rendered.body));
  }
}

// --- leasing.daily_snapshot event (digest — S333) --------------------------
{
  const ev = getNotificationEvent("leasing.daily_snapshot");
  ok("snapshot: registered", ev !== null);
  ok("snapshot: leasing family", ev?.family === "leasing");
  ok("snapshot: operator audience", ev?.audience === "operator");
  ok("snapshot: active", ev?.active === true);
  ok("snapshot: in active set", activeNotificationEvents().some((e) => e.key === "leasing.daily_snapshot"));
  ok("snapshot: no alert accent (informational)", ev?.defaultAccent === undefined);
  if (ev) {
    const declared = new Set(ev.tokens);
    const used = [...(ev.defaultSubject + " " + ev.defaultBody).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map(
      (m) => m[1].toLowerCase(),
    );
    ok("snapshot: all template tokens declared", used.every((t) => declared.has(t)));
    ok("snapshot: declares snapshot token", declared.has("snapshot"));
    const rendered = renderNotification(ev, null, {
      org_name: "Agile",
      snapshot_date: "Thursday, June 25",
      new_count: "2",
      showings_today_count: "1",
      snapshot: "NEW LEADS — LAST 24 HOURS (2)\n\n• Jane Doe — 22 King St W",
      dashboard_url: "https://x/dashboard/leads",
    });
    ok("snapshot: renders date in subject", rendered.subject.includes("Thursday, June 25"));
    ok("snapshot: inlines snapshot block", rendered.body.includes("• Jane Doe — 22 King St W"));
    ok("snapshot: no leftover tokens", !/\{\{/.test(rendered.subject + rendered.body));
  }
}

// --- accent color (S332) ----------------------------------------------------
{
  const newLead = getNotificationEvent("leasing.new_lead")!;
  const scheduled = getNotificationEvent("dispatch.scheduled.trade")!;
  // normalizeAccentColor
  ok("accent: blank -> null", (() => { const r = normalizeAccentColor("  "); return r.ok && r.value === null; })());
  ok("accent: hex preserved + lowercased", (() => { const r = normalizeAccentColor("#DC2626"); return r.ok && r.value === "#dc2626"; })());
  ok("accent: bare hex gets #", (() => { const r = normalizeAccentColor("dc2626"); return r.ok && r.value === "#dc2626"; })());
  ok("accent: bad value rejected", !normalizeAccentColor("red").ok);
  ok("accent: short hex rejected", !normalizeAccentColor("#fff").ok);
  // resolveNotificationAccent: override > event default > null
  ok(
    "accent: override wins",
    resolveNotificationAccent(newLead, {
      event_key: newLead.key, enabled: true, subject_template: null,
      body_template: null, recipients: null, accent_color: "#00ff00",
    }) === "#00ff00",
  );
  // The fallback branch (override absent -> event default) still works, tested
  // against a synthetic event that carries a code default. (No shipped event
  // carries one anymore — new_lead's forced red was dropped in the P3 pass.)
  const withDefault = { ...newLead, defaultAccent: "#dc2626" };
  ok("accent: falls back to event default", resolveNotificationAccent(withDefault, null) === "#dc2626");
  ok("accent: no default -> null", resolveNotificationAccent(scheduled, null) === null);
  // Post-S402: new_lead no longer forces a red accent — with no override it
  // resolves to null so the shell uses the org brand color.
  ok("accent: new_lead has no forced default", resolveNotificationAccent(newLead, null) === null);
  ok(
    "accent: blank override -> event default",
    resolveNotificationAccent(withDefault, {
      event_key: newLead.key, enabled: true, subject_template: null,
      body_template: null, recipients: null, accent_color: "   ",
    }) === "#dc2626",
  );
}

// ---------------------------------------------------------------------------
console.log(`\nnotifications: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// Unit/source tests for S642 Relist Radar Slice 2 email and decision surface.
// Run: npx tsx scripts/test-relist-radar-email.ts
import { readFileSync } from "node:fs";
import { channelByKey } from "../lib/distribution-channels";
import { getNotificationEvent } from "../lib/notifications";
import {
  RELIST_RADAR_EMAIL_EVENT_KEY,
  RELIST_RADAR_LAST_CHANCE_EVENT_KEY,
  RELIST_RADAR_PAID_LAPSE_EVENT_KEY,
  buildRelistRadarEmail,
  createRelistRadarDecisionToken,
  relistRadarDecisionForAction,
  relistRadarDecisionTokenHash,
  relistRadarEmailChannelIncluded,
  relistRadarStandingAutoRefreshConsent,
  verifyRelistRadarDecisionToken,
  type RelistRadarEmailItem,
} from "../lib/relist-radar";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const APP_URL = "https://app.vacantless.com";
const SECRET = "test-relist-radar-secret";
const NOW_MS = Date.parse("2026-08-11T14:00:00.000Z");

const token = createRelistRadarDecisionToken({
  runItemId: "run-item-1",
  portal: "kijiji",
  action: "skip",
  cycleDate: "2026-08-14",
  secret: SECRET,
  nowMs: NOW_MS,
});
const verified = verifyRelistRadarDecisionToken(token.token, SECRET, NOW_MS);
ok("token verifies", verified.ok === true);
ok("token hash is sha256 hex", /^[a-f0-9]{64}$/.test(token.tokenHash));
ok("token hash helper matches", relistRadarDecisionTokenHash(token.token) === token.tokenHash);
ok(
  "token binds run item portal action cycle",
  verified.ok &&
    verified.payload.run_item_id === "run-item-1" &&
    verified.payload.portal === "kijiji" &&
    verified.payload.action === "skip" &&
    verified.payload.cycle_date === "2026-08-14",
);
ok("tampered token rejected", verifyRelistRadarDecisionToken(`${token.token}x`, SECRET, NOW_MS).ok === false);
ok(
  "expired token rejected",
  verifyRelistRadarDecisionToken(token.token, SECRET, NOW_MS + 8 * 86_400_000).ok === false,
);
ok("missing secret rejected", verifyRelistRadarDecisionToken(token.token, null, NOW_MS).ok === false);

ok("skip maps to skipped", relistRadarDecisionForAction("skip") === "skipped");
ok("consent maps to paid consent", relistRadarDecisionForAction("consent") === "paid_consented");
ok("keep maps to kept live", relistRadarDecisionForAction("keep_live") === "kept_live");
ok("let expire maps to let expire", relistRadarDecisionForAction("let_expire") === "let_expire");

ok("kijiji email included", relistRadarEmailChannelIncluded(channelByKey("kijiji")));
ok("free api autopilot omitted", !relistRadarEmailChannelIncluded(channelByKey("facebook_feed")));
ok("paid channel included", relistRadarEmailChannelIncluded({ mode: "assisted_manual", paid: true }));
ok(
  "standing auto-refresh consent needs both flags",
  relistRadarStandingAutoRefreshConsent({
    automation_authorized: true,
    auto_submit_allowed: true,
  }),
);
ok(
  "partial automation consent is not hands-off",
  !relistRadarStandingAutoRefreshConsent({
    automation_authorized: true,
    auto_submit_allowed: false,
  }),
);

function emailItem(overrides: Partial<RelistRadarEmailItem> = {}): RelistRadarEmailItem {
  return {
    runItemId: overrides.runItemId ?? "run-item-1",
    channel: overrides.channel ?? "kijiji",
    channelLabel: overrides.channelLabel ?? "Kijiji",
    paid: overrides.paid ?? false,
    cycleDate: overrides.cycleDate ?? "2026-08-14",
    externalExpiresAt: overrides.externalExpiresAt ?? "2026-08-14T13:00:00.000Z",
    feeLabel: overrides.feeLabel ?? null,
    feeCents: overrides.feeCents ?? null,
    actionUrls: {
      manage: overrides.actionUrls?.manage ?? `${APP_URL}/dashboard/properties/property-1?tab=distribute#distribute`,
      skip: overrides.actionUrls?.skip ?? `${APP_URL}/api/relist-radar/decision/free`,
      consent: overrides.actionUrls?.consent ?? `${APP_URL}/api/relist-radar/decision/paid`,
      keepLive: overrides.actionUrls?.keepLive ?? `${APP_URL}/api/relist-radar/decision/keep`,
      letExpire: overrides.actionUrls?.letExpire ?? `${APP_URL}/api/relist-radar/decision/expire`,
    },
  };
}

{
  const email = buildRelistRadarEmail({
    kind: "notice",
    propertyAddress: "50 Glenrose Ave Unit 4",
    propertyId: "property-1",
    appUrl: APP_URL,
    items: [
      emailItem(),
      emailItem({
        runItemId: "run-item-2",
        channel: "viewit",
        channelLabel: "Viewit.ca",
        paid: true,
        feeCents: 5495,
      }),
    ],
  });
  ok("notice subject names refresh", email.subject.includes("Refresh listing ads"));
  ok("notice body has free expiry", email.body.includes("Kijiji expires on"));
  ok("notice body has free auto-refresh copy", email.body.includes("auto-refresh on the expiry-day morning"));
  ok("notice body has paid refresh amount", email.body.includes("$54.95"));
  ok("notice safety says no charge", email.body.includes("will not charge, repost, edit, or submit"));
  ok("notice has skip button", email.actions.some((a) => a.label === "Skip Kijiji"));
  ok("notice has paid refresh button", email.actions.some((a) => a.label === "Refresh for $54.95"));
  ok("notice has manage button", email.actions.some((a) => a.label === "Manage in Distribute"));
}

{
  const email = buildRelistRadarEmail({
    kind: "last_chance",
    propertyAddress: "50 Glenrose Ave Unit 4",
    propertyId: "property-1",
    appUrl: APP_URL,
    items: [emailItem()],
  });
  ok("last chance subject", email.subject.startsWith("Last chance"));
  ok("last chance keep action", email.actions.some((a) => a.label === "Keep Kijiji live"));
  ok("last chance let expire action", email.actions.some((a) => a.label === "Let Kijiji expire"));
}

{
  const email = buildRelistRadarEmail({
    kind: "paid_lapse",
    propertyAddress: "50 Glenrose Ave Unit 4",
    propertyId: "property-1",
    appUrl: APP_URL,
    items: [emailItem({ paid: true, channelLabel: "Viewit.ca" })],
  });
  ok("paid lapse subject", email.subject.startsWith("Paid listing expired"));
  ok("paid lapse no-response copy", email.body.includes("No paid-refresh consent was recorded"));
  ok("paid lapse has paid consent action", email.actions.some((a) => a.label === "Refresh for the site fee"));
  ok("paid lapse keeps manage action", email.actions.some((a) => a.label === "Manage in Distribute"));
}

{
  const email = buildRelistRadarEmail({
    kind: "notice",
    propertyAddress: "50 Glenrose Ave Unit 4",
    propertyId: "property-1",
    appUrl: APP_URL,
    items: [emailItem()],
    locale: "fr",
  });
  ok("fr subject supported", email.subject.includes("Rafraichir"));
  ok("fr body supported", email.body.includes("annonce"));
}

for (const key of [
  RELIST_RADAR_EMAIL_EVENT_KEY,
  RELIST_RADAR_LAST_CHANCE_EVENT_KEY,
  RELIST_RADAR_PAID_LAPSE_EVENT_KEY,
]) {
  const event = getNotificationEvent(key);
  ok(`${key} event registered`, event?.key === key);
  ok(`${key} listing lane`, event?.lane === "listing");
  ok(`${key} body token`, event?.tokens.includes("relist_radar_body") === true);
}

const migration = readFileSync("supabase/migrations/0212_relist_radar_email_decisions.sql", "utf8");
ok("migration adds decision", migration.includes("add column if not exists decision text"));
ok("migration adds sent stamps", migration.includes("notice_sent_at") && migration.includes("last_chance_sent_at"));
ok("migration creates token store", migration.includes("create table if not exists public.relist_radar_decision_tokens"));
ok("migration stores token hash only", migration.includes("token_hash text not null unique"));
ok("migration keeps decision values constrained", migration.includes("'paid_consented'") && migration.includes("'no_response'"));

const route = readFileSync("app/api/relist-radar/decision/[token]/route.ts", "utf8");
ok("decision route verifies HMAC token", route.includes("verifyRelistRadarDecisionToken"));
ok("decision route burns token", route.includes("used_at"));
ok("decision route rejects reused token", route.includes("Already used"));
ok("decision route records no execution copy", route.includes("No charge or repost was made"));
ok("decision route race guards skipped last chance", route.includes("decision.eq.skipped"));
ok("decision route allows paid lapse consent", route.includes("decision.eq.no_response"));

const cron = readFileSync("app/api/cron/distribution-freshness/route.ts", "utf8");
ok("cron email send is flag gated", cron.includes("RELIST_RADAR_EMAIL_ENABLED"));
ok("cron reuses notification substrate", cron.includes("sendOrgNotification"));
ok("cron mints radar decision tokens", cron.includes("createRelistRadarDecisionToken"));
ok("cron stores token hashes only", cron.includes('.from("relist_radar_decision_tokens")'));
ok("cron omits standing hands-off free portals", cron.includes("relistRadarStandingAutoRefreshConsent"));
ok("cron stamps notice only after send path", cron.includes("notice_sent_at: nowISO"));
ok("cron stamps paid lapse no response", cron.includes('decision: "no_response"'));
ok("cron stays test-org scoped", cron.includes("RELIST_RADAR_TEST_ORG_ID"));

console.log(`relist-radar-email: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

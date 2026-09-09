// Pure tests for Post Everywhere Slice 1's tile read model (SPEC-S688 3.1, 3.2,
// 3.6): the nine resolution steps, the cap/cost table row by row, the label
// fallback, needsCheck, and the state ordering.
// Run: npx tsx scripts/test-session-status-readmodel.ts
import {
  CHANNEL_COST_CENTS,
  CHANNEL_FREE_CAP,
  channelCostCapLine,
  channelTileStatus,
  formatChannelMoney,
  isSessionStale,
  sessionCheckReason,
  spendReadyForAccount,
  type ChannelTileAccount,
  type ChannelTileSession,
} from "../lib/distribution-channels";
import {
  buildChannelTileStatuses,
  channelTileLine,
} from "../lib/distribution-channel-tile-statuses";
import { stage3SendableChannels } from "../lib/stage3-send-live";
import { classifyGraphMe } from "../lib/distribution-session-status";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}
function eq(name: string, actual: unknown, expected: unknown) {
  ok(name, actual === expected);
  if (actual !== expected) {
    console.error(`    expected: ${String(expected)}`);
    console.error(`    actual:   ${String(actual)}`);
  }
}

const NOW = Date.parse("2026-09-07T15:00:00Z");
const fresh = (over: Partial<ChannelTileSession> = {}): ChannelTileSession => ({
  account_label: "Noam",
  alive: true,
  cap_used: 0,
  cap_total: null,
  last_checked_at: new Date(NOW - 60_000).toISOString(),
  last_check_code: "ok",
  last_check_error: null,
  check_pending: false,
  stale: false,
  ...over,
});
const connected = (over: Partial<ChannelTileAccount> = {}): ChannelTileAccount => ({
  account_status: "connected",
  automation_authorized: true,
  external_account_label: "Noam (account row)",
  ...over,
});

// --- 3.1 resolution order, one positive case per step -----------------------
eq("1 unknown key -> not_available_yet", channelTileStatus("nope", connected(), fresh(), NOW).state, "not_available_yet");
eq("2 mls_gated -> mls_only", channelTileStatus("realtor_ca", connected(), fresh(), NOW).state, "mls_only");
eq("3 planned -> not_available_yet", channelTileStatus("rentfaster", connected(), fresh(), NOW).state, "not_available_yet");
eq("3b planned + selfPost (Marketplace) -> self_post", channelTileStatus("facebook", connected(), fresh(), NOW).state, "self_post");
{
  const s = channelTileStatus("kijiji", null, fresh(), NOW);
  eq("4 no account -> not_linked", s.state, "not_linked");
  ok("4 not_linked can connect", s.canConnect === true);
  ok("4 not_linked carries no label", s.accountLabel === null);
  eq("4 account_status=needs_setup -> not_linked", channelTileStatus("kijiji", { account_status: "needs_setup" }, fresh(), NOW).state, "not_linked");
}
{
  const s = channelTileStatus("rentals_ca", connected(), fresh({ alive: false, last_check_code: "needs_login" }), NOW);
  eq("5 alive=false -> dead_session", s.state, "dead_session");
  ok("5 dead_session can reconnect", s.canReconnect === true);
  ok("5 dead_session cannot 'connect'", s.canConnect === false);
  ok("5 dead_session still says who", s.accountLabel === "Noam");
  ok("5 headline names the reason", s.headline === "Sign in to Noam again: signed out");
  eq("5 account needs_login -> dead_session even with alive=true", channelTileStatus("rentals_ca", connected({ account_status: "needs_login" }), fresh(), NOW).state, "dead_session");
  eq("5 dead_session lastCheckCode carried", s.lastCheckCode, "needs_login");
}
{
  const missing = channelTileStatus("zumper", connected(), null, NOW);
  eq("6 session row missing (model on) -> dead_session", missing.state, "dead_session");
  eq("6 missing row reason no_session", missing.lastCheckCode, "no_session");
  ok("6 missing row does not request a probe", missing.needsCheck === false);
  ok("6 missing row can reconnect", missing.canReconnect === true);
  const unprobed = channelTileStatus("zumper", connected(), fresh({ alive: null, last_checked_at: null, last_check_code: null, stale: true }), NOW);
  eq("6 row never probed -> checking", unprobed.state, "checking");
  ok("6 never probed needsCheck", unprobed.needsCheck === true);
  const stale = channelTileStatus("zumper", connected(), fresh({ stale: true, check_pending: false }), NOW);
  eq("6 stale -> checking", stale.state, "checking");
  ok("6 stale + not pending needsCheck", stale.needsCheck === true);
  const pending = channelTileStatus("zumper", connected(), fresh({ stale: true, check_pending: true }), NOW);
  eq("6 stale + pending -> checking", pending.state, "checking");
  ok("6 pending does not re-request", pending.needsCheck === false);
  const derived = channelTileStatus("zumper", connected(), fresh({ stale: null, last_checked_at: new Date(NOW - 25 * 3600_000).toISOString() }), NOW);
  eq("6 stale derived from last_checked_at when view column absent", derived.state, "checking");
  ok("6 stale session still shows label", stale.accountLabel === "Noam");
}
{
  const s = channelTileStatus("rentals_ca", connected(), fresh({ cap_used: 3, cap_total: 3 }), NOW);
  eq("7 cap_used >= cap_total -> cap_reached", s.state, "cap_reached");
  ok("7 cap_reached cannot connect", s.canConnect === false);
  eq("7 constant cap fallback when cap_total null", channelTileStatus("zumper", connected(), fresh({ cap_used: 5, cap_total: null }), NOW).state, "cap_reached");
  eq("7 worker cap_total wins over constant", channelTileStatus("zumper", connected(), fresh({ cap_used: 5, cap_total: 10 }), NOW).state, "linked");
  eq("7 kijiji personal tier caps at 1", channelTileStatus("kijiji", connected({ capabilities: { kijiji_tier: "personal" } }), fresh({ cap_used: 1 }), NOW).state, "cap_reached");
  eq("7 kijiji business tier never caps", channelTileStatus("kijiji", connected({ capabilities: { kijiji_tier: "business" } }), fresh({ cap_used: 9 }), NOW).state, "linked");
  eq("7 kijiji unknown tier never caps", channelTileStatus("kijiji", connected(), fresh({ cap_used: 9 }), NOW).state, "linked");
}
{
  const s = channelTileStatus("rentals_ca", connected({ automation_authorized: false }), fresh(), NOW);
  eq("8 authorized=false -> connected_needs_authorization", s.state, "connected_needs_authorization");
  ok("8 headline names the account", s.headline.startsWith("Signed in as Noam."));
}
{
  const s = channelTileStatus("rentals_ca", connected(), fresh({ cap_used: 1 }), NOW);
  eq("9 linked", s.state, "linked");
  eq("9 linked cap line", s.capLine, "Free for 3 listings. You use 1 of 3.");
  eq("9 linked cost line", s.costLine, "Free.");
  eq("9 linked lastCheckedAt carried", s.lastCheckedAt, fresh().last_checked_at);
  ok("9 linked alive true", s.alive === true);
}

// --- reconnect clears a dead verdict (review defect 1) ------------------------
{
  const checkedAt = new Date(NOW - 3600_000).toISOString();
  const deadThenReconnected = fresh({
    alive: false,
    last_check_code: "needs_login",
    last_checked_at: checkedAt,
    last_validated_at: new Date(NOW - 60_000).toISOString(), // written AFTER the probe
    stale: false,
  });
  const s = channelTileStatus("facebook_feed", connected(), deadThenReconnected, NOW);
  eq("reconnect after a dead probe -> checking, not dead", s.state, "checking");
  ok("reconnect after a dead probe asks for a re-probe", s.needsCheck === true);
  const stillDead = fresh({
    alive: false,
    last_check_code: "needs_login",
    last_checked_at: new Date(NOW - 60_000).toISOString(),
    last_validated_at: checkedAt, // probe is newer than the last write
  });
  eq("dead probe newer than the last write stays dead", channelTileStatus("facebook_feed", connected(), stillDead, NOW).state, "dead_session");
  eq("dead probe with no last_validated_at stays dead", channelTileStatus("facebook_feed", connected(), fresh({ alive: false, last_validated_at: null }), NOW).state, "dead_session");
  eq("account needs_login is dead regardless of write order", channelTileStatus("facebook_feed", connected({ account_status: "needs_login" }), deadThenReconnected, NOW).state, "dead_session");
}

// --- ordering ----------------------------------------------------------------
eq("cap_reached outranks connected_needs_authorization", channelTileStatus("rentals_ca", connected({ automation_authorized: false }), fresh({ cap_used: 3 }), NOW).state, "cap_reached");
eq("dead_session outranks cap_reached", channelTileStatus("rentals_ca", connected(), fresh({ alive: false, cap_used: 3 }), NOW).state, "dead_session");
eq("dead_session outranks checking", channelTileStatus("rentals_ca", connected(), fresh({ alive: false, stale: true }), NOW).state, "dead_session");
eq("checking outranks cap_reached", channelTileStatus("rentals_ca", connected(), fresh({ stale: true, cap_used: 3 }), NOW).state, "checking");

// --- legacy callers (session undefined = model off) --------------------------
{
  const s = channelTileStatus("rentals_ca", connected());
  eq("model off: connected + authorized -> linked (no checking)", s.state, "linked");
  ok("model off: label falls back to account row", s.accountLabel === "Noam (account row)");
  eq("model off: connected + unauthorized -> connected_needs_authorization", channelTileStatus("rentals_ca", connected({ automation_authorized: false })).state, "connected_needs_authorization");
  eq("model off: needs_login account -> dead_session", channelTileStatus("rentals_ca", connected({ account_status: "needs_login" })).state, "dead_session");
  eq("model off: no account -> not_linked", channelTileStatus("rentals_ca", null).state, "not_linked");
  eq("model off: oauth connected -> linked", channelTileStatus("facebook_feed", connected()).state, "linked");
  eq("model off: cap line still renders the unknown case", s.capLine, "Free for 3 listings per account.");
}

// --- label fallback ------------------------------------------------------------
ok("session label wins", channelTileStatus("kijiji", connected(), fresh({ account_label: "Kijiji Name" }), NOW).accountLabel === "Kijiji Name");
ok("null session label falls back to external_account_label", channelTileStatus("kijiji", connected(), fresh({ account_label: null }), NOW).accountLabel === "Noam (account row)");
ok("no label anywhere -> null", channelTileStatus("kijiji", connected({ external_account_label: null }), fresh({ account_label: null }), NOW).accountLabel === null);

// --- 3.2 table, row by row -------------------------------------------------------
const line = (key: string, account: ChannelTileAccount | null, session: ChannelTileSession | null) =>
  channelCostCapLine(key, account, session);
{
  const r = line("kijiji", connected(), fresh());
  eq("kijiji tier unset cap", r.capLine, null);
  eq("kijiji tier unset cost", r.costLine, "Tell us if this is a personal or business Kijiji account.");
  ok("kijiji tier unset not reached", r.capReached === false);
}
{
  const p = { capabilities: { kijiji_tier: "personal" } };
  const r0 = line("kijiji", connected(p), fresh({ cap_used: 0 }));
  eq("kijiji personal 0 cap", r0.capLine, "Your 1 free ad is available.");
  eq("kijiji personal 0 cost", r0.costLine, "Free. The next ad after it is $33.84.");
  const rn = line("kijiji", connected(p), fresh({ cap_used: null }));
  eq("kijiji personal null cap", rn.capLine, "Your 1 free ad is available.");
  const r1 = line("kijiji", connected(p), fresh({ cap_used: 1 }));
  eq("kijiji personal 1 cap", r1.capLine, "You used your 1 free ad.");
  eq("kijiji personal 1 cost + spend suffix", r1.costLine, "$33.84 per extra ad, paid at the last step. Set your limit before a paid post.");
  ok("kijiji personal 1 reached", r1.capReached === true);
  const r1s = line("kijiji", connected({ ...p, spend_authorized: true, spend_max_cents: 5000, spend_revoked_at: null }), fresh({ cap_used: 1 }));
  eq("kijiji personal 1 cost, spend ready", r1s.costLine, "$33.84 per extra ad, paid at the last step.");
}
{
  const b = { capabilities: { kijiji_tier: "business" } };
  const r = line("kijiji", connected(b), fresh({ cap_used: 4 }));
  eq("kijiji business cap", r.capLine, null);
  eq("kijiji business cost", r.costLine, "$33.84 per ad, paid at the last step. Set your limit before a paid post.");
  ok("kijiji business never reached", r.capReached === false);
  eq("kijiji business revoked spend keeps suffix", line("kijiji", connected({ ...b, spend_authorized: true, spend_max_cents: 5000, spend_revoked_at: "2026-09-01T00:00:00Z" }), fresh()).costLine, "$33.84 per ad, paid at the last step. Set your limit before a paid post.");
}
eq("rentals n<3 cap", line("rentals_ca", connected(), fresh({ cap_used: 2 })).capLine, "Free for 3 listings. You use 2 of 3.");
eq("rentals n<3 cost", line("rentals_ca", connected(), fresh({ cap_used: 2 })).costLine, "Free.");
{
  const r = line("rentals_ca", connected(), fresh({ cap_used: 3 }));
  eq("rentals 3 cap", r.capLine, "You use all 3 free listings. Turn one off first.");
  ok("rentals 3 reached", r.capReached === true);
}
eq("rentals null cap", line("rentals_ca", connected(), fresh({ cap_used: null })).capLine, "Free for 3 listings per account.");
eq("zumper n<5 cap", line("zumper", connected(), fresh({ cap_used: 4 })).capLine, "Free: 4 of 5 listings used.");
eq("zumper 5 cap", line("zumper", connected(), fresh({ cap_used: 5 })).capLine, "You use all 5 free listings. Take one down first.");
ok("zumper 5 reached", line("zumper", connected(), fresh({ cap_used: 5 })).capReached === true);
eq("zumper null cap", line("zumper", connected(), fresh({ cap_used: null })).capLine, "Free: up to 5 listings per account.");
eq("facebook_feed cap", line("facebook_feed", connected(), fresh()).capLine, null);
eq("facebook_feed cost", line("facebook_feed", connected(), fresh()).costLine, "Free.");
eq("instagram cost", line("instagram", connected(), fresh()).costLine, "Free.");
eq("planned channel cap", line("rentfaster", connected(), fresh()).capLine, null);
eq("planned channel cost", line("rentfaster", connected(), fresh()).costLine, null);
eq("unknown channel cost", line("nope", connected(), fresh()).costLine, null);

// --- money + constants ------------------------------------------------------------
eq("3384 -> $33.84", formatChannelMoney(3384), "$33.84");
ok("fr-CA money", formatChannelMoney(3384, "fr").includes("33,84"));
eq("kijiji constant", CHANNEL_COST_CENTS.kijiji, 3384);
eq("rentals free cap 3", CHANNEL_FREE_CAP.rentals_ca, 3);
eq("zumper free cap 5", CHANNEL_FREE_CAP.zumper, 5);
ok("no kijiji free cap constant (tier decides)", CHANNEL_FREE_CAP.kijiji === undefined);
ok("spendReady mirrors contracts predicate", spendReadyForAccount({ spend_authorized: true, spend_max_cents: 1, spend_revoked_at: null }) && !spendReadyForAccount({ spend_authorized: true, spend_max_cents: 0 }) && !spendReadyForAccount({ spend_authorized: false, spend_max_cents: 100 }));

// --- reasons + stale ------------------------------------------------------------------
eq("reason needs_login", sessionCheckReason("needs_login"), "signed out");
eq("reason cloudflare", sessionCheckReason("cloudflare"), "the site asked for a human check");
eq("reason captcha", sessionCheckReason("captcha"), "the site asked for a human check");
eq("reason no_session", sessionCheckReason("no_session"), "no saved sign-in");
eq("reason timeout", sessionCheckReason("timeout"), "the site did not respond");
eq("reason error", sessionCheckReason("error"), "an error");
eq("reason unknown -> signed out", sessionCheckReason("what"), "signed out");
ok("stale: null", isSessionStale(null, NOW));
ok("stale: 25h", isSessionStale(new Date(NOW - 25 * 3600_000).toISOString(), NOW));
ok("fresh: 23h", !isSessionStale(new Date(NOW - 23 * 3600_000).toISOString(), NOW));

// --- buildChannelTileStatuses wiring ------------------------------------------------
{
  const accounts = [
    { channel: "rentals_ca", account_status: "connected", automation_authorized: true, external_account_label: "acct" },
    { channel: "zumper", account_status: "connected", automation_authorized: true },
  ];
  const sessions = [
    { channel: "rentals_ca", account_label: "n@example.com", alive: true, cap_used: 1, cap_total: 3, last_checked_at: fresh().last_checked_at!, last_check_code: "ok", last_check_error: null, check_pending: false, stale: false },
    { channel: "zumper", account_label: null, alive: null, cap_used: null, cap_total: null, last_checked_at: null, last_check_code: null, last_check_error: null, check_pending: false, stale: true },
  ];
  const on = new Map(buildChannelTileStatuses(accounts, sessions, NOW).map((r) => [r.channel, r]));
  eq("wired: rentals_ca linked with session", on.get("rentals_ca")?.state, "linked");
  eq("wired: rentals_ca label from session", on.get("rentals_ca")?.accountLabel, "n@example.com");
  eq("wired: zumper with an unprobed session row -> checking", on.get("zumper")?.state, "checking");
  eq("wired: kijiji connected without a session row -> dead_session", buildChannelTileStatuses([{ channel: "kijiji", account_status: "connected", automation_authorized: true }], [], NOW).find((r) => r.channel === "kijiji")?.state, "dead_session");
  eq("wired: kijiji no account -> not_linked", on.get("kijiji")?.state, "not_linked");
  const off = new Map(buildChannelTileStatuses(accounts, undefined, NOW).map((r) => [r.channel, r]));
  eq("wired, model off: zumper linked", off.get("zumper")?.state, "linked");
  eq("wired, model off: rentals label from account row", off.get("rentals_ca")?.accountLabel, "acct");
  const empty = new Map(buildChannelTileStatuses(accounts, [], NOW).map((r) => [r.channel, r]));
  eq("wired, zero session rows still means model on", empty.get("rentals_ca")?.state, "dead_session");

  // Stage 3 keeps the pre-Slice-1 sendable set: linked and not-yet-probed.
  const sendable = stage3SendableChannels([...on.values()]).map((r) => r.channel);
  ok("stage3: linked is sendable", sendable.includes("rentals_ca"));
  ok("stage3: checking is sendable", sendable.includes("zumper"));
  ok("stage3: not_linked is not", !sendable.includes("kijiji"));
  const dead = buildChannelTileStatuses(accounts, [{ ...sessions[0], alive: false, last_check_code: "needs_login" }], NOW);
  ok("stage3: dead_session is not sendable", !stage3SendableChannels(dead).some((r) => r.channel === "rentals_ca"));
  const capped = buildChannelTileStatuses(accounts, [{ ...sessions[0], cap_used: 3 }], NOW);
  ok("stage3: cap_reached is not sendable", !stage3SendableChannels(capped).some((r) => r.channel === "rentals_ca"));
}

// --- tile lines -------------------------------------------------------------------------
ok("line: checking", channelTileLine("kijiji", "checking") === "Checking your Kijiji account.");
ok("line: dead_session", channelTileLine("kijiji", "dead_session").startsWith("Kijiji session ended"));
ok("line: cap_reached", channelTileLine("zumper", "cap_reached") === "Zumper + PadMapper free cap reached.");
ok("line: connected_needs_authorization", channelTileLine("kijiji", "connected_needs_authorization").includes("not authorized"));

// --- Graph /me classification (3.5) ------------------------------------------------------
eq("graph 200 -> ok", classifyGraphMe({ status: 200, body: { id: "1", name: "Page" } }).code, "ok");
eq("graph 200 label", classifyGraphMe({ status: 200, body: { id: "1", name: "Page" } }).label, "Page");
eq("graph 190 -> needs_login", classifyGraphMe({ status: 400, body: { error: { code: 190, message: "expired" } } }).code, "needs_login");
eq("graph 401 -> needs_login", classifyGraphMe({ status: 401, body: null }).code, "needs_login");
eq("graph 500 -> error", classifyGraphMe({ status: 500, body: null }).code, "error");
eq("graph 200 without id -> error", classifyGraphMe({ status: 200, body: {} }).code, "error");

console.log(`\nsession-status-readmodel: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// ============================================================================
// Read-only deployed DB and safety check for S279 Keep-live reminders.
//
// Run:
//   node --env-file=.env.local scripts/verify-relist-radar-deployed.mjs
//
// This deliberately avoids fixture writes and does not:
//   - call the distribution-freshness cron route
//   - send landlord/operator email
//   - enqueue worker refreshes
//   - post, refresh, remove, or pay on any external portal
// ============================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE) {
  console.error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let passed = 0;
const failures = [];
const notes = [];

function pass(name) {
  passed++;
  console.log(`PASS ${name}`);
}

function fail(name, detail) {
  const message = detail?.message ?? String(detail ?? "failed");
  failures.push(`${name}: ${message}`);
  console.error(`FAIL ${name}: ${message}`);
}

function ok(name, condition, detail) {
  if (condition) {
    pass(name);
  } else {
    fail(name, detail);
  }
}

function info(name, detail) {
  const message = detail == null ? name : `${name}: ${detail}`;
  notes.push(message);
  console.log(`INFO ${message}`);
}

function envFlagEnabled(value) {
  return ["1", "true", "yes", "on", "enabled"].includes(
    String(value ?? "").trim().toLowerCase(),
  );
}

function readSource(path) {
  return readFileSync(path, "utf8");
}

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : -1;
  if (start < 0) return "";
  return source.slice(start, end > start ? end : undefined);
}

async function expectSelect(name, query) {
  const { error } = await query;
  if (error) {
    fail(name, error);
    return;
  }
  pass(name);
}

function sourceChecks() {
  const route = readSource("app/api/cron/distribution-freshness/route.ts");
  const relistRadar = readSource("lib/relist-radar.ts");
  const migration211 = readSource("supabase/migrations/0211_relist_radar_clock.sql");
  const migration212 = readSource("supabase/migrations/0212_relist_radar_email_decisions.sql");
  const migration213 = readSource("supabase/migrations/0213_relist_radar_free_execution.sql");

  const clockGate = sourceSlice(
    route,
    "if (envFlagEnabled(process.env.RELIST_RADAR_CLOCK_ENABLED))",
    "if (envFlagEnabled(process.env.RELIST_RADAR_EMAIL_ENABLED))",
  );
  const emailGate = sourceSlice(
    route,
    "if (envFlagEnabled(process.env.RELIST_RADAR_EMAIL_ENABLED))",
    "if (envFlagEnabled(process.env.RELIST_RADAR_EXECUTE_FREE_ENABLED))",
  );
  const executeGate = sourceSlice(
    route,
    "if (envFlagEnabled(process.env.RELIST_RADAR_EXECUTE_FREE_ENABLED))",
    "await sendListingHealthAlerts",
  );
  const enqueueSource = sourceSlice(
    route,
    "async function enqueueRelistRadarFreeRefresh",
    "async function executeRelistRadarFreeRefreshes",
  );

  ok(
    "source separates Keep-live candidate clock behind RELIST_RADAR_CLOCK_ENABLED",
    clockGate.includes("detectRelistRadarCandidates") &&
      !clockGate.includes("sendRelistRadarEmails") &&
      !clockGate.includes("executeRelistRadarFreeRefreshes"),
  );
  ok(
    "source separates landlord email behind RELIST_RADAR_EMAIL_ENABLED",
    emailGate.includes("sendRelistRadarEmails") &&
      !emailGate.includes("detectRelistRadarCandidates") &&
      !emailGate.includes("executeRelistRadarFreeRefreshes"),
  );
  ok(
    "source separates free worker enqueue behind RELIST_RADAR_EXECUTE_FREE_ENABLED",
    executeGate.includes("executeRelistRadarFreeRefreshes") &&
      executeGate.includes("RELIST_RADAR_EMAIL_ENABLED") &&
      executeGate.includes("sendRelistRadarAutopilotRecaps"),
  );
  ok(
    "source uses org allowlist filters for Keep-live clock/email scans",
    route.includes("relistRadarAllowedOrgFilter()") &&
      route.includes("relistRadarOrgAllowed(item.organization_id)"),
  );
  ok(
    "source records candidates idempotently by item/event/cycle",
    route.includes('onConflict: "run_item_id,event_type,cycle_date"') &&
      route.includes("ignoreDuplicates: true"),
  );
  ok(
    "source mints signed decision tokens and stores token hashes only",
    route.includes("createRelistRadarDecisionToken") &&
      route.includes("token_hash: created.tokenHash") &&
      migration212.includes("token_hash text not null unique"),
  );
  ok(
    "source notification copy says email decisions do not charge or repost",
    relistRadar.includes("will not charge, repost, edit, or submit") &&
      migration212.includes("does not charge, repost, edit"),
  );
  ok(
    "source keeps free refresh as a worker queue item, not a live mark",
    enqueueSource.includes('publish_status: "needs_operator"') &&
      !enqueueSource.includes('publish_status: "live"'),
  );
  ok(
    "source free refresh avoids concierge credit consumption",
    enqueueSource.includes("Do not call claim_concierge_leaseup") &&
      !enqueueSource.includes("claim_concierge_leaseup("),
  );
  ok(
    "source migrations define expiry clock, decisions, and refresh backup",
    migration211.includes("external_expires_at") &&
      migration211.includes("relist_radar_events") &&
      migration212.includes("relist_radar_decision_tokens") &&
      migration213.includes("relist_radar_backup"),
  );
}

function envChecks() {
  const clockEnabled = envFlagEnabled(process.env.RELIST_RADAR_CLOCK_ENABLED);
  const emailEnabled = envFlagEnabled(process.env.RELIST_RADAR_EMAIL_ENABLED);
  const executeFreeEnabled = envFlagEnabled(
    process.env.RELIST_RADAR_EXECUTE_FREE_ENABLED,
  );
  const allowlistCount = String(process.env.RELIST_RADAR_ORG_ALLOWLIST ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean).length;
  const tokenSecretPresent = Boolean(
    String(process.env.RELIST_RADAR_TOKEN_SECRET ?? process.env.CRON_SECRET ?? "").trim(),
  );

  info("current RELIST_RADAR_CLOCK_ENABLED", clockEnabled ? "enabled" : "disabled");
  info("current RELIST_RADAR_ORG_ALLOWLIST count", allowlistCount);
  ok(
    "current env has landlord Relist Radar email disabled for this no-email readback",
    !emailEnabled,
  );
  ok(
    "current env has free worker refresh execution disabled for this no-worker readback",
    !executeFreeEnabled,
  );
  ok(
    "decision token secret is not required while email sending is disabled",
    !emailEnabled || tokenSecretPresent,
  );
}

async function deployedDbChecks() {
  await expectSelect(
    "distribution_run_items exposes expiry clock and refresh backup columns",
    admin
      .from("distribution_run_items")
      .select(
        "id, organization_id, run_id, channel, publish_status, external_posted_at, external_expires_at, relist_radar_backup",
      )
      .limit(1),
  );

  await expectSelect(
    "relist_radar_settings is selectable by service role",
    admin
      .from("relist_radar_settings")
      .select("organization_id, settings, created_at, updated_at")
      .limit(1),
  );

  await expectSelect(
    "relist_radar_events exposes candidate, decision, and send-stamp columns",
    admin
      .from("relist_radar_events")
      .select(
        "id, organization_id, property_id, run_id, run_item_id, listing_post_id, channel, event_type, cycle_date, external_expires_at, paid, decision, decided_at, decided_via, notice_sent_at, last_chance_sent_at, lapse_nudge_sent_at, metadata",
      )
      .limit(1),
  );

  await expectSelect(
    "relist_radar_decision_tokens stores hashed one-click decisions",
    admin
      .from("relist_radar_decision_tokens")
      .select(
        "id, organization_id, event_id, run_item_id, cycle_date, channel, action, token_hash, expires_at, used_at, metadata",
      )
      .limit(1),
  );

  await expectSelect(
    "distribution_channel_accounts exposes refresh authorization columns",
    admin
      .from("distribution_channel_accounts")
      .select(
        "organization_id, channel, account_status, automation_authorized, auto_submit_allowed, requires_payment, spend_authorized, spend_max_cents",
      )
      .limit(1),
  );
}

async function main() {
  sourceChecks();
  envChecks();
  await deployedDbChecks();

  console.log(
    JSON.stringify({ passed, failed: failures.length, failures, notes }, null, 2),
  );
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

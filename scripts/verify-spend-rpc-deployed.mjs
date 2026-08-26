// ============================================================================
// Read-only deployed DB check for S668/S279 paid-worker spend authorization.
//
// Run:
//   node --env-file=.env.local scripts/verify-spend-rpc-deployed.mjs
//
// This deliberately avoids fixture writes:
//   - selects zero/one rows from the tables that must expose the spend columns
//   - calls claim_approved_distribution_run_item_for_worker with impossible ids
//     and a synthetic channel, which should return [] without claiming anything
// ============================================================================

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

const IMPOSSIBLE_ITEM_ID = "00000000-0000-4000-8000-000000000001";
const IMPOSSIBLE_ORG_ID = "00000000-0000-4000-8000-000000000002";
const WORKER_CLAIM_ID = "00000000-0000-4553-8000-000000000553";
const PROBE_CHANNEL = "__codex_spend_rpc_readonly_probe__";

let passed = 0;
const failures = [];

function pass(name) {
  passed++;
  console.log(`PASS ${name}`);
}

function fail(name, error) {
  const message = error?.message ?? String(error ?? "unknown error");
  failures.push(`${name}: ${message}`);
  console.error(`FAIL ${name}: ${message}`);
}

async function expectSelect(name, query) {
  const { error } = await query;
  if (error) {
    fail(name, error);
    return;
  }
  pass(name);
}

async function main() {
  await expectSelect(
    "distribution_channel_accounts exposes standing spend columns",
    admin
      .from("distribution_channel_accounts")
      .select(
        "organization_id, channel, automation_authorized, requires_payment, spend_authorized, spend_max_cents, spend_period_max_cents, spend_revoked_at",
      )
      .limit(1),
  );

  await expectSelect(
    "distribution_channel_spend ledger is selectable by service role",
    admin
      .from("distribution_channel_spend")
      .select("id, organization_id, channel, distribution_run_item_id, amount_cents, currency, charged_at")
      .limit(1),
  );

  await expectSelect(
    "distribution_run_items exposes worker approval/claim columns",
    admin
      .from("distribution_run_items")
      .select(
        "id, organization_id, run_id, channel, mode, publish_status, concierge_claimed_by, operator_submit_approved_at, operator_submit_approved_by",
      )
      .limit(1),
  );

  const { data, error } = await admin.rpc("claim_approved_distribution_run_item_for_worker", {
    p_item_id: IMPOSSIBLE_ITEM_ID,
    p_organization_id: IMPOSSIBLE_ORG_ID,
    p_channel: PROBE_CHANNEL,
    p_worker_claim_id: WORKER_CLAIM_ID,
  });
  if (error) {
    fail("claim RPC exists and accepts worker arguments", error);
  } else if (!Array.isArray(data) || data.length !== 0) {
    fail(
      "claim RPC is no-op for impossible ids",
      new Error(`expected [], received ${JSON.stringify(data)}`),
    );
  } else {
    pass("claim RPC exists, accepts worker arguments, and no-ops for impossible ids");
  }

  console.log(JSON.stringify({ passed, failed: failures.length, failures }, null, 2));
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

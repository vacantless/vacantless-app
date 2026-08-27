// ============================================================================
// DB fixture proof for S668/S279 paid-worker spend authorization.
//
// Default is non-mutating:
//   node --env-file=.env.local scripts/verify-spend-rpc-fixture.mjs
//
// Apply creates isolated synthetic child rows inside an existing test org,
// proves refusal + successful claim, and deletes those child rows in finally:
//   node --env-file=.env.local scripts/verify-spend-rpc-fixture.mjs --apply --org-id=<test-org-uuid>
//
// This does not run the worker, open a portal, post an ad, send email, or pay.
// ============================================================================

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE) {
  console.error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const WORKER_CLAIM_ID = "00000000-0000-4553-8000-000000000553";
const OPERATOR_ID = "00000000-0000-4000-8000-000000000668";
const FIXTURE_CHANNEL = argValue("--channel=") ?? "snapchat";
const FIXTURE_ORG_ID = argValue("--org-id=");

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let passed = 0;
const failures = [];

function argValue(prefix) {
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function ok(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`PASS ${name}`);
    return;
  }
  const message = detail == null ? name : `${name}: ${detail}`;
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function failFast(label, error) {
  const message = error?.message ?? String(error ?? "unknown error");
  throw new Error(`${label}: ${message}`);
}

async function insertOne(table, payload) {
  const { data, error } = await admin.from(table).insert(payload).select("*").single();
  if (error) failFast(`insert ${table}`, error);
  return data;
}

async function updateOne(table, id, payload) {
  const { data, error } = await admin.from(table).update(payload).eq("id", id).select("*").single();
  if (error) failFast(`update ${table}`, error);
  return data;
}

async function readItem(id) {
  const { data, error } = await admin
    .from("distribution_run_items")
    .select(
      "id, publish_status, status, concierge_claimed_by, operator_submit_approved_at, error_code, error_message, audit_message, last_attempted_at",
    )
    .eq("id", id)
    .single();
  if (error) failFast("read distribution_run_items", error);
  return data;
}

async function callClaimRpc(itemId, orgId) {
  const { data, error } = await admin.rpc("claim_approved_distribution_run_item_for_worker", {
    p_item_id: itemId,
    p_organization_id: orgId,
    p_channel: FIXTURE_CHANNEL,
    p_worker_claim_id: WORKER_CLAIM_ID,
  });
  if (error) failFast("claim_approved_distribution_run_item_for_worker", error);
  if (!Array.isArray(data)) {
    throw new Error(`claim RPC returned non-array payload: ${JSON.stringify(data)}`);
  }
  return data;
}

async function deleteWhere(table, filter) {
  let query = admin.from(table).delete();
  for (const [column, value] of Object.entries(filter)) {
    query = query.eq(column, value);
  }
  const { error } = await query;
  if (error) failFast(`cleanup ${table}`, error);
}

async function assertNoRows(table, filter, name) {
  let query = admin.from(table).select("*");
  for (const [column, value] of Object.entries(filter)) {
    query = query.eq(column, value);
  }
  const { data, error } = await query;
  if (error) failFast(`verify cleanup ${table}`, error);
  ok(name, (data ?? []).length === 0, JSON.stringify(data));
}

async function main() {
  if (!APPLY) {
    console.log(
      "DRY RUN: pass --apply --org-id=<test-org-uuid> to create isolated synthetic DB rows, prove refusal/claim, and clean them up.",
    );
    console.log(`Default fixture channel: ${FIXTURE_CHANNEL}`);
    console.log("No worker, portal, email, payment, or external listing action is ever performed.");
    return;
  }
  if (!FIXTURE_ORG_ID) {
    console.error("Missing --org-id=<test-org-uuid>. Refusing to create fixture rows without an explicit existing test org.");
    process.exit(1);
  }

  const stamp = Date.now();
  const orgId = FIXTURE_ORG_ID;
  const propertyId = randomUUID();
  const runId = randomUUID();
  const itemId = randomUUID();
  const address = `Codex Spend RPC Fixture Unit ${stamp}`;
  let createdAccount = false;

  try {
    const { data: orgRows, error: orgErr } = await admin
      .from("organizations")
      .select("id, name, slug")
      .eq("id", orgId);
    if (orgErr) failFast("read fixture organization", orgErr);
    if ((orgRows ?? []).length !== 1) {
      throw new Error(`fixture org ${orgId} was not found or was not unique`);
    }

    const { data: existingAccount, error: accountReadErr } = await admin
      .from("distribution_channel_accounts")
      .select("id, channel")
      .eq("organization_id", orgId)
      .eq("channel", FIXTURE_CHANNEL);
    if (accountReadErr) failFast("read fixture channel account", accountReadErr);
    if ((existingAccount ?? []).length > 0) {
      throw new Error(`fixture channel ${FIXTURE_CHANNEL} already exists for org ${orgId}; pass --channel=<unused-channel>`);
    }

    await insertOne("properties", {
      id: propertyId,
      organization_id: orgId,
      address,
      status: "available",
    });
    await insertOne("distribution_runs", {
      id: runId,
      organization_id: orgId,
      property_id: propertyId,
      status: "active",
    });
    await insertOne("distribution_channel_accounts", {
      organization_id: orgId,
      channel: FIXTURE_CHANNEL,
      transport: "concierge",
      account_status: "connected",
      requires_login: true,
      requires_payment: true,
      supports_concierge: true,
      posting_policy: "concierge_only",
      automation_authorized: true,
      spend_authorized: false,
      spend_max_cents: null,
      spend_period_max_cents: null,
      spend_revoked_at: null,
    });
    createdAccount = true;
    await insertOne("distribution_run_items", {
      id: itemId,
      organization_id: orgId,
      run_id: runId,
      channel: FIXTURE_CHANNEL,
      status: "in_progress",
      mode: "concierge",
      publish_status: "needs_operator",
      operator_submit_approved_at: new Date().toISOString(),
      operator_submit_approved_by: OPERATOR_ID,
    });

    const refusedRows = await callClaimRpc(itemId, orgId);
    const refused = refusedRows[0] ?? null;
    ok(
      "missing standing spend authorization is refused",
      refusedRows.length === 1 &&
        refused?.id === itemId &&
        refused?.refused === true &&
        refused?.refusal_reason === "spend_not_authorized",
      JSON.stringify(refusedRows),
    );
    const refusedItem = await readItem(itemId);
    ok(
      "refusal clears approval and leaves item unclaimed",
      refusedItem.publish_status === "needs_operator" &&
        refusedItem.concierge_claimed_by == null &&
        refusedItem.operator_submit_approved_at == null &&
        refusedItem.error_code === "spend_authorization_required",
      JSON.stringify(refusedItem),
    );

    await admin
      .from("distribution_channel_accounts")
      .update({
        spend_authorized: true,
        spend_max_cents: 5000,
        spend_period_max_cents: null,
        spend_authorized_at: new Date().toISOString(),
        spend_authorized_by: null,
        spend_revoked_at: null,
      })
      .eq("organization_id", orgId)
      .eq("channel", FIXTURE_CHANNEL)
      .throwOnError();

    await updateOne("distribution_run_items", itemId, {
      publish_status: "needs_operator",
      status: "in_progress",
      concierge_claimed_by: null,
      concierge_claimed_at: null,
      operator_submit_approved_at: new Date().toISOString(),
      operator_submit_approved_by: OPERATOR_ID,
      error_code: null,
      error_message: null,
      audit_message: null,
      last_attempted_at: null,
    });

    const claimedRows = await callClaimRpc(itemId, orgId);
    const claimed = claimedRows[0] ?? null;
    ok(
      "authorized standing spend lets RPC claim the approved item",
      claimedRows.length === 1 &&
        claimed?.id === itemId &&
        claimed?.refused === false &&
        claimed?.refusal_reason == null,
      JSON.stringify(claimedRows),
    );
    const claimedItem = await readItem(itemId);
    ok(
      "claim CAS moves item to submitting with the worker sentinel",
      claimedItem.publish_status === "submitting" &&
        claimedItem.status === "in_progress" &&
        claimedItem.concierge_claimed_by === WORKER_CLAIM_ID &&
        claimedItem.operator_submit_approved_at != null &&
        claimedItem.last_attempted_at != null,
      JSON.stringify(claimedItem),
    );
  } finally {
    await deleteWhere("distribution_run_items", { id: itemId });
    await deleteWhere("distribution_runs", { id: runId });
    if (createdAccount) {
      await deleteWhere("distribution_channel_accounts", {
        organization_id: orgId,
        channel: FIXTURE_CHANNEL,
      });
    }
    await deleteWhere("properties", { id: propertyId });
    await assertNoRows("distribution_run_items", { id: itemId }, "fixture run item was cleaned up");
    await assertNoRows("distribution_runs", { id: runId }, "fixture run was cleaned up");
    if (createdAccount) {
      await assertNoRows(
        "distribution_channel_accounts",
        { organization_id: orgId, channel: FIXTURE_CHANNEL },
        "fixture channel account was cleaned up",
      );
    }
    await assertNoRows("properties", { id: propertyId }, "fixture property was cleaned up");
  }

  console.log(JSON.stringify({ passed, failed: failures.length, failures }, null, 2));
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

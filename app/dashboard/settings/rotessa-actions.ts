"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { encryptSecret, decryptSecret, encryptionConfigured } from "@/lib/crypto";
import {
  validateApiKey,
  normalizeEnvironment,
  testConnection,
} from "@/lib/rotessa";

// Rotessa rent-collection connection actions (platform pivot step 2, S210).
//
// All three guard on manage_rotessa (owner_admin + operator; a viewing helper
// can't touch the rent rail). The API key is encrypted with lib/crypto before
// it ever reaches the DB, and is only decrypted server-side for a live call —
// it is NEVER returned to the page. We store/READ status only; no bank data.
//
// Like the branding action, these REDIRECT (not revalidate-only) on purpose
// (the S170 Vercel-edge revalidate-503 WATCH).

const SETTINGS = "/dashboard/settings";

// Connect (or re-connect / replace key): validate -> live test -> encrypt +
// upsert the per-org row with the resulting status. One row per org (unique
// organization_id), so this upserts on conflict.
export async function connectRotessa(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_rotessa", `${SETTINGS}?forbidden=1`);

  const keyResult = validateApiKey(String(formData.get("api_key") ?? ""));
  const environment = normalizeEnvironment(String(formData.get("environment") ?? "sandbox"));

  if (!keyResult.ok) redirect(`${SETTINGS}?rotessa=invalid#rotessa`);
  if (!encryptionConfigured()) redirect(`${SETTINGS}?rotessa=nokey#rotessa`);

  // Live-verify the key before we save it as "connected".
  const test = await testConnection(keyResult.value, environment);

  const supabase = createClient();
  const { error } = await supabase
    .from("rotessa_accounts")
    .upsert(
      {
        organization_id: org.id,
        api_key_encrypted: encryptSecret(keyResult.value),
        environment,
        connection_status: test.status,
        last_verified_at: test.ok ? new Date().toISOString() : null,
        last_error: test.ok ? null : test.message,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    );

  if (error) redirect(`${SETTINGS}?rotessa=saveerror#rotessa`);
  redirect(`${SETTINGS}?rotessa=${test.ok ? "connected" : "connfail"}#rotessa`);
}

// Re-test the stored key (e.g. after a Rotessa outage, or to confirm a key
// rotation). Loads + decrypts the stored key, calls Rotessa, updates status.
export async function testRotessaConnection() {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_rotessa", `${SETTINGS}?forbidden=1`);

  const supabase = createClient();
  const { data } = await supabase
    .from("rotessa_accounts")
    .select("api_key_encrypted, environment")
    .eq("organization_id", org.id)
    .limit(1);

  const row = data?.[0] as { api_key_encrypted: string | null; environment: string } | undefined;
  if (!row?.api_key_encrypted) redirect(`${SETTINGS}?rotessa=norow#rotessa`);

  let apiKey: string;
  try {
    apiKey = decryptSecret(row.api_key_encrypted);
  } catch {
    redirect(`${SETTINGS}?rotessa=decfail#rotessa`);
    return; // unreachable; satisfies the type checker (redirect throws)
  }

  const environment = normalizeEnvironment(row.environment);
  const test = await testConnection(apiKey, environment);

  await supabase
    .from("rotessa_accounts")
    .update({
      connection_status: test.status,
      last_verified_at: test.ok ? new Date().toISOString() : null,
      last_error: test.ok ? null : test.message,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", org.id);

  redirect(`${SETTINGS}?rotessa=${test.ok ? "tested" : "testfail"}#rotessa`);
}

// Disconnect: remove the stored key + row entirely. (Rotessa-side customers /
// schedules are untouched — this only severs Vacantless's stored connection.)
export async function disconnectRotessa() {
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  await requireCapability("manage_rotessa", `${SETTINGS}?forbidden=1`);

  const supabase = createClient();
  await supabase.from("rotessa_accounts").delete().eq("organization_id", org.id);

  redirect(`${SETTINGS}?rotessa=disconnected#rotessa`);
}

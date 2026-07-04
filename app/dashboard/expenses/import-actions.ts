"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { planEntitlements } from "@/lib/billing";
import { canImportTransactions, filterNewTransactions } from "@/lib/bank-feed";
import { parseImportFile, importConnectionExternalId, defaultImportLabel } from "@/lib/bank-import";
import { autoApplyRules } from "./triage-core";

// File-import bank feed (S411). Kept in its OWN action file (not actions.ts) so
// it does not collide with the reviewed live-sync surface. An uploaded OFX/QFX
// export is parsed to NormalizedTxn[], hung off a SYNTHETIC provider='csv'
// connection, and staged into bank_transactions with source='import' — then it
// flows through the EXACT same dedupe + autoApplyRules + triage + owner statement
// as a Plaid transaction. See CSV-OFX-BANK-FEED-IMPORT-SPEC-2026-07-01.md.
//
// Gating mirrors the live feed: manage_work_orders capability AND the org must be
// entitled to the bank feed (canImportTransactions). No credentials, no PDF
// statements; the raw account number is masked to last-4 in the parser and the
// uploaded bytes are parsed in-memory and never persisted.

const BASE = "/dashboard/expenses";
const MAX_IMPORT_BYTES = 8 * 1024 * 1024; // 8 MB — a transaction export is small

export async function importTransactionsFromFile(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?bank=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  if (!canImportTransactions(planEntitlements(org.plan))) redirect(`${BASE}?bank=locked`);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) redirect(`${BASE}?import=nofile`);
  if (file.size > MAX_IMPORT_BYTES) redirect(`${BASE}?import=toobig`);

  let content = "";
  try {
    content = await file.text();
  } catch {
    redirect(`${BASE}?import=unreadable`);
  }

  const parsed = parseImportFile({ filename: file.name, content });
  if (!parsed.ok) redirect(`${BASE}?import=${parsed.reason}`);
  if (parsed.txns.length === 0) redirect(`${BASE}?import=no_transactions`);

  const labelInput = String(formData.get("account_label") ?? "").trim().slice(0, 80);
  const label = labelInput || defaultImportLabel(parsed.accountMask, parsed.accountType);

  const supabase = createClient();

  // Create/reuse the synthetic import connection. Keyed on the account mask (or a
  // normalized label) so re-importing the same account reuses this row and its
  // staged transactions — which is what makes re-import idempotent.
  const externalId = importConnectionExternalId(parsed.format, parsed.accountMask, label);
  const { data: conn, error: connErr } = await supabase
    .from("bank_connections")
    .upsert(
      {
        organization_id: org.id,
        provider: "csv",
        external_id: externalId,
        institution_name: label,
        import_format: parsed.format,
        status: "active",
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,provider,external_id" },
    )
    .select("id")
    .single();
  if (connErr || !conn) redirect(`${BASE}?import=save`);

  // Dedupe against what's already staged for this connection (FITID = external_id).
  const { data: existing } = await supabase
    .from("bank_transactions")
    .select("external_id")
    .eq("connection_id", conn.id);
  const existingIds = new Set((existing ?? []).map((r) => r.external_id as string));
  const fresh = filterNewTransactions(parsed.txns, existingIds);

  if (fresh.length > 0) {
    const rows = fresh.map((t) => ({
      organization_id: org.id,
      connection_id: conn.id,
      external_id: t.externalId,
      account_external_id: t.accountExternalId, // last-4 mask only
      account_name: label,
      posted_on: t.postedOn,
      amount_cents: t.amountCents,
      direction: t.direction,
      merchant: t.merchant,
      description: t.description,
      raw_category: t.rawCategory,
      currency: t.currency,
      merchant_entity_id: t.merchantEntityId,
      stream_id: t.streamId,
      source: "import",
    }));
    await supabase.from("bank_transactions").insert(rows);

    // Same as the live sync: auto-file the freshly-staged debits that match a
    // saved categorization rule.
    await autoApplyRules(org.id);
  }

  const skipped = parsed.txns.length - fresh.length;
  revalidatePath(BASE);
  redirect(`${BASE}?imported=${fresh.length}&skipped=${skipped}`);
}

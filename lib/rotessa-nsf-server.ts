// S835d. Server-only: read each connected Rotessa account's transaction report
// and, for a failed rent debit on a linked tenancy, add the NSF charge, record
// Rotessa's fee as an expense, and email the owners. One per transaction
// (tenancy_nsf_charges.external_ref is unique), so running it again adds
// nothing. Reads only: nothing is changed at Rotessa. Never throws.
//
// NEVER import this into a client component.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchTransactionReport } from "@/lib/rotessa";
import { loadRotessaConn } from "@/lib/rotessa-rent";
import { nsfExpenseNote } from "@/lib/nsf-charge";
import { notifyRentPaymentFailed } from "@/lib/rent-failed-notify";
import {
  ROTESSA_NSF_FEE_CENTS,
  ROTESSA_NSF_LOOKBACK_DAYS,
  isFailedRotessaTransaction,
  isoDaysAgo,
  rotessaAmountCents,
  rotessaNsfDate,
  rotessaNsfNote,
  rotessaNsfRef,
} from "@/lib/rotessa-nsf";

type TenancyRow = {
  id: string;
  organization_id: string;
  property_id: string | null;
  rotessa_customer_id: string | null;
  tenants: { name: string | null; is_primary: boolean | null }[] | null;
};

export async function runRotessaNsfSweep(opts: { admin: SupabaseClient; todayIso: string }) {
  const { admin, todayIso } = opts;
  const out = { ok: true, accounts: 0, read: 0, recorded: 0, emailed: 0, failed: 0 };
  try {
    const { data, error } = await admin
      .from("tenancies")
      .select("id, organization_id, property_id, rotessa_customer_id, tenants(name, is_primary)")
      .not("rotessa_customer_id", "is", null)
      .limit(1000);
    if (error) return { ...out, ok: false, error: error.message };
    const byOrg = new Map<string, TenancyRow[]>();
    for (const t of (data ?? []) as unknown as TenancyRow[]) {
      const list = byOrg.get(t.organization_id) ?? [];
      list.push(t);
      byOrg.set(t.organization_id, list);
    }
    for (const [orgId, tenancies] of byOrg) {
      const conn = await loadRotessaConn(admin, orgId);
      if (!conn) continue; // disconnected: nothing to read
      out.accounts++;
      // One Rotessa customer on two tenancies is ambiguous: leave both alone.
      const counts = new Map<string, number>();
      for (const t of tenancies) counts.set(t.rotessa_customer_id!, (counts.get(t.rotessa_customer_id!) ?? 0) + 1);
      const byCustomer = new Map<string, TenancyRow>();
      for (const t of tenancies) if (counts.get(t.rotessa_customer_id!) === 1) byCustomer.set(t.rotessa_customer_id!, t);

      const report = await fetchTransactionReport(conn.apiKey, conn.environment, {
        startDate: isoDaysAgo(todayIso, ROTESSA_NSF_LOOKBACK_DAYS),
      });
      if (!report.ok) {
        out.failed++;
        out.ok = false;
        console.error("[rotessa-nsf] report not read for", orgId, report.message);
        continue;
      }
      out.read++;
      for (const txn of report.transactions) {
        if (!isFailedRotessaTransaction(txn) || !txn.id || !txn.customerId) continue;
        const t = byCustomer.get(txn.customerId);
        if (!t) continue;
        const incurredOn = rotessaNsfDate(txn.processDate, todayIso);
        const { data: charge, error: chargeErr } = await admin
          .from("tenancy_nsf_charges")
          .insert({
            organization_id: t.organization_id,
            tenancy_id: t.id,
            incurred_on: incurredOn,
            bank_charge_cents: ROTESSA_NSF_FEE_CENTS,
            admin_charge_cents: 0,
            note: rotessaNsfNote(txn.statusReason),
            // The table's source list is 'stripe' or 'manual'; the note and
            // external_ref say it came from Rotessa.
            source: "manual",
            external_ref: rotessaNsfRef(txn.id),
          })
          .select("id")
          .maybeSingle();
        if (chargeErr) {
          if (chargeErr.code === "23505") continue; // already recorded on an earlier run
          out.failed++;
          out.ok = false;
          console.error("[rotessa-nsf] charge not saved:", chargeErr.message);
          continue;
        }
        out.recorded++;
        const primary = (t.tenants ?? []).find((x) => x.is_primary) ?? (t.tenants ?? [])[0] ?? null;
        const { data: expense, error: expErr } = await admin
          .from("expenses")
          .insert({
            organization_id: t.organization_id,
            property_id: t.property_id,
            category: "other",
            amount_cents: ROTESSA_NSF_FEE_CENTS,
            incurred_on: incurredOn,
            merchant: "Rotessa",
            note: nsfExpenseNote(primary?.name),
            source: "manual",
          })
          .select("id")
          .maybeSingle();
        if (expErr) console.error("[rotessa-nsf] expense not saved:", expErr.message);
        else if (expense && charge) {
          await admin
            .from("tenancy_nsf_charges")
            .update({ expense_id: (expense as { id: string }).id })
            .eq("id", (charge as { id: string }).id);
        }
        const mail = await notifyRentPaymentFailed(admin, t.id, rotessaAmountCents(txn.amount), "rotessa");
        out.emailed += mail.sent;
      }
    }
    return out;
  } catch (e) {
    console.error("[rotessa-nsf]", e instanceof Error ? e.message : e);
    return { ...out, ok: false, error: "sweep_error" };
  }
}

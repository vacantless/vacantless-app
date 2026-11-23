// S835c. Server-only: record the fee and the NSF charge when a tenant's Stripe
// rent debit fails. Called by the Stripe webhook on invoice.payment_failed.
// Never throws. One charge per failed invoice (stripe_invoice_id is unique),
// so a second failure notice for the same invoice records nothing more.
//
// NEVER import this into a client component.

import type { SupabaseClient } from "@supabase/supabase-js";
import { STRIPE_NSF_FEE_CENTS, nsfExpenseNote } from "@/lib/nsf-charge";

export async function recordStripeNsf(
  admin: SupabaseClient,
  args: { tenancyId: string; invoiceId: string | null; amountDueCents: number | null; incurredOn: string },
): Promise<{ recorded: boolean; reason?: string }> {
  try {
    // The $0 invoice before the first charge date is not a payment.
    if (args.amountDueCents != null && args.amountDueCents <= 0) return { recorded: false, reason: "zero_invoice" };
    if (!args.invoiceId) return { recorded: false, reason: "no_invoice_id" };
    const { data: tRow } = await admin
      .from("tenancies")
      .select("id, organization_id, property_id, tenants(name, is_primary)")
      .eq("id", args.tenancyId)
      .maybeSingle();
    const t = tRow as unknown as {
      id: string;
      organization_id: string;
      property_id: string | null;
      tenants: { name: string | null; is_primary: boolean | null }[] | null;
    } | null;
    if (!t) return { recorded: false, reason: "no_tenancy" };
    const primary = (t.tenants ?? []).find((x) => x.is_primary) ?? (t.tenants ?? [])[0] ?? null;

    // The charge first: its unique invoice id is what stops a double record.
    const { data: charge, error: chargeErr } = await admin
      .from("tenancy_nsf_charges")
      .insert({
        organization_id: t.organization_id,
        tenancy_id: t.id,
        incurred_on: args.incurredOn,
        bank_charge_cents: STRIPE_NSF_FEE_CENTS,
        admin_charge_cents: 0,
        note: "Stripe's fee for the failed bank debit.",
        source: "stripe",
        stripe_invoice_id: args.invoiceId,
      })
      .select("id")
      .maybeSingle();
    if (chargeErr) {
      if (chargeErr.code === "23505") return { recorded: false, reason: "already_recorded" };
      console.error("[nsf] charge not saved:", chargeErr.message);
      return { recorded: false, reason: "charge_failed" };
    }

    const { data: expense, error: expErr } = await admin
      .from("expenses")
      .insert({
        organization_id: t.organization_id,
        property_id: t.property_id,
        category: "other",
        amount_cents: STRIPE_NSF_FEE_CENTS,
        incurred_on: args.incurredOn,
        merchant: "Stripe",
        note: nsfExpenseNote(primary?.name),
        // The note says Vacantless recorded it; the source list is unchanged.
        source: "manual",
      })
      .select("id")
      .maybeSingle();
    if (expErr) {
      console.error("[nsf] expense not saved:", expErr.message);
    } else if (expense && charge) {
      await admin
        .from("tenancy_nsf_charges")
        .update({ expense_id: (expense as { id: string }).id })
        .eq("id", (charge as { id: string }).id);
    }
    return { recorded: true };
  } catch (e) {
    console.error("[nsf]", e instanceof Error ? e.message : e);
    return { recorded: false, reason: "error" };
  }
}

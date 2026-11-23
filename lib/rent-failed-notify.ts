// S835b (REVIEW-S835 finding 5). Server-only: email the account owners when a
// tenant's rent debit fails. Called by the Stripe webhook on
// invoice.payment_failed for a connected account. Never throws.
//
// NEVER import this into a client component.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendNotificationEmail } from "@/lib/email";
import { getUserByIdCached } from "@/lib/auth-email-cache";
import { formatRentCents } from "@/lib/tenancy";
import { rentFailedEmail } from "@/lib/rent-failed";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(/\/+$/, "");

export async function notifyRentPaymentFailed(
  admin: SupabaseClient,
  tenancyId: string,
  amountDueCents: number | null,
): Promise<{ sent: number }> {
  // The $0 invoice Stripe cuts before the first charge date is not a payment.
  if (amountDueCents != null && amountDueCents <= 0) return { sent: 0 };
  try {
    const { data: tRow } = await admin
      .from("tenancies")
      .select("id, organization_id, property:properties(address), tenants(name, is_primary)")
      .eq("id", tenancyId)
      .maybeSingle();
    const t = tRow as unknown as {
      id: string;
      organization_id: string;
      property: { address: string | null } | null;
      tenants: { name: string | null; is_primary: boolean | null }[] | null;
    } | null;
    if (!t) return { sent: 0 };
    const { data: oRow } = await admin
      .from("organizations")
      .select("name, brand_color, logo_url")
      .eq("id", t.organization_id)
      .maybeSingle();
    const org = oRow as { name: string | null; brand_color: string | null; logo_url: string | null } | null;
    const primary = (t.tenants ?? []).find((x) => x.is_primary) ?? (t.tenants ?? [])[0] ?? null;
    const mail = rentFailedEmail({
      tenantName: primary?.name ?? null,
      address: t.property?.address ?? null,
      amountLabel: amountDueCents != null ? formatRentCents(amountDueCents) : null,
    });
    const { data: members } = await admin
      .from("memberships")
      .select("user_id")
      .eq("organization_id", t.organization_id)
      .eq("role", "owner_admin");
    let sent = 0;
    const seen = new Set<string>();
    for (const m of (members ?? []) as { user_id: string }[]) {
      const { data } = await getUserByIdCached(admin, m.user_id);
      const to = data.user?.email?.trim().toLowerCase();
      if (!to || seen.has(to)) continue;
      seen.add(to);
      const res = await sendNotificationEmail({
        to_email: to,
        subject: mail.subject,
        body: mail.body,
        action_label: mail.actionLabel,
        action_url: `${APP_URL}/dashboard/tenancies/${t.id}#rent-collection`,
        org_name: org?.name ?? "Vacantless",
        brand_color: org?.brand_color ?? null,
        logo_url: org?.logo_url ?? null,
        reply_to_email: null,
      }).catch(() => ({ sent: false }));
      if (res.sent) sent++;
    }
    if (sent === 0) console.error("[rent-failed] no owner email went out for tenancy", tenancyId);
    return { sent };
  } catch (e) {
    console.error("[rent-failed]", e instanceof Error ? e.message : e);
    return { sent: 0 };
  }
}

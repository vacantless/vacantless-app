// S742e: run "this one rented, here are the others" for one rental. Called
// from both lease-up paths (the rental's status save and a new tenancy).
// Best effort and never throws: a lease-up must never fail on an email.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Org } from "./org";
import { sendRentedNoticeEmail, type RentedNoticeOtherUnit } from "./email";
import {
  RENTED_NOTICE_OTHER_UNITS,
  leadsToCloseQuietly,
  leadsToNotify,
  type WaitingLead,
} from "./rented-notice";

export type RentedNoticeReport = { sent: number; closed: number; failed: number; skipped: string | null };

type Client = Pick<SupabaseClient, "from">;

export async function notifyWaitingRentersRented(args: {
  client: Client;
  org: Org;
  propertyId: string;
  now?: Date;
}): Promise<RentedNoticeReport> {
  const report: RentedNoticeReport = { sent: 0, closed: 0, failed: 0, skipped: null };
  const { client, org, propertyId } = args;
  const nowMs = (args.now ?? new Date()).getTime();
  try {
    const { data: prop } = await client
      .from("properties")
      .select("id, address, status")
      .eq("id", propertyId)
      .eq("organization_id", org.id)
      .maybeSingle();
    const property = prop as { id: string; address: string | null; status: string | null } | null;
    if (!property || property.status !== "leased") {
      report.skipped = "not_leased";
      return report;
    }

    const { data: leadRows } = await client
      .from("leads")
      .select("id, name, email, status, created_at")
      .eq("organization_id", org.id)
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(500);
    const leads = (leadRows ?? []) as WaitingLead[];
    const toNotify = leadsToNotify(leads, nowMs);
    const toClose = leadsToCloseQuietly(leads, toNotify);
    if (toNotify.length === 0 && toClose.length === 0) {
      report.skipped = "nobody_waiting";
      return report;
    }

    const { data: otherRows } = await client
      .from("properties")
      .select("id, address, rent_cents, beds, baths")
      .eq("organization_id", org.id)
      .eq("status", "available")
      .is("archived_at", null)
      .neq("id", propertyId)
      .order("created_at", { ascending: false })
      .limit(RENTED_NOTICE_OTHER_UNITS);
    const others: RentedNoticeOtherUnit[] = ((otherRows ?? []) as {
      id: string; address: string | null; rent_cents: number | null; beds: number | null; baths: number | null;
    }[]).map((u) => ({ property_id: u.id, address: u.address, rent_cents: u.rent_cents, beds: u.beds, baths: u.baths }));

    for (const lead of toNotify) {
      const result = await sendRentedNoticeEmail({
        lead_id: lead.id,
        property_id: propertyId,
        renter_name: lead.name,
        renter_email: lead.email,
        org_name: org.name,
        brand_color: org.brand_color,
        logo_url: org.logo_url,
        mail_alias: org.mail_alias,
        reply_to_email: org.reply_to_email,
        property_address: property.address,
        others,
      });
      if (result.sent) {
        report.sent++;
        await client.from("messages").insert({
          organization_id: org.id,
          lead_id: lead.id,
          channel: "email",
          direction: "outbound",
          body: `Rented notice sent to ${lead.email}: "${result.subject ?? ""}"` +
            (others.length > 0 ? ` with ${others.length} other open rental${others.length === 1 ? "" : "s"}` : ""),
        });
      } else {
        report.failed++;
      }
    }

    // Every open request on a rented unit closes as Lost, emailed or not.
    const ids = [...toNotify.map((l) => l.id), ...toClose.map((l) => l.id)];
    if (ids.length > 0) {
      const { data: upd } = await client
        .from("leads")
        .update({ status: "lost" })
        .in("id", ids)
        .eq("organization_id", org.id)
        .select("id");
      report.closed = Array.isArray(upd) ? upd.length : 0;
    }
  } catch (e) {
    report.skipped = `error:${e instanceof Error ? e.message : String(e)}`;
  }
  return report;
}

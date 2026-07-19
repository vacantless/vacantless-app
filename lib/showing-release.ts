import type { SupabaseClient } from "@supabase/supabase-js";
import { formatSlotLong } from "@/lib/booking";
import { sendShowingAutoReleased } from "@/lib/email";
import { sendOrgNotification } from "@/lib/notifications-server";

export type ReleaseShowingOrg = {
  id: string;
  name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  public_contact_email?: string | null;
  booking_timezone?: string | null;
};

export type ReleaseUnconfirmedShowingResult = {
  released: boolean;
  reason?:
    | "empty_id"
    | "not_found"
    | "not_open"
    | "confirmed"
    | "past"
    | "update_missed"
    | "update_error";
};

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return (rel as T) ?? null;
}

export async function releaseUnconfirmedShowing(
  client: SupabaseClient,
  args: {
    org: ReleaseShowingOrg;
    showingId: string;
    appUrl: string;
    nowIso?: string;
    noteBody?: string;
  },
): Promise<ReleaseUnconfirmedShowingResult> {
  const showingId = args.showingId.trim();
  if (!showingId) return { released: false, reason: "empty_id" };

  const nowIso = args.nowIso ?? new Date().toISOString();
  const { data: row } = await client
    .from("showings")
    .select(
      "id, outcome, confirmed_at, scheduled_at, lead_id, " +
        "lead:leads(id, name, email), property:properties(id, address), " +
        "assigned_agent:showing_agents(id, name, email)",
    )
    .eq("id", showingId)
    .eq("organization_id", args.org.id)
    .maybeSingle();
  if (!row) return { released: false, reason: "not_found" };

  const showing = row as unknown as {
    id: string;
    outcome: string | null;
    confirmed_at: string | null;
    scheduled_at: string | null;
    lead_id: string | null;
    lead: { id: string; name: string | null; email: string | null } | null;
    property: { id: string; address: string | null } | null;
    assigned_agent: { id: string; name: string | null; email: string | null } | null;
  };
  if (showing.outcome !== "scheduled") return { released: false, reason: "not_open" };
  if (showing.confirmed_at != null) return { released: false, reason: "confirmed" };
  if (!showing.scheduled_at || new Date(showing.scheduled_at).getTime() <= new Date(nowIso).getTime()) {
    return { released: false, reason: "past" };
  }

  const { data: updated, error: updateErr } = await client
    .from("showings")
    .update({ outcome: "cancelled" })
    .eq("id", showing.id)
    .eq("organization_id", args.org.id)
    .eq("outcome", "scheduled")
    .is("confirmed_at", null)
    .gt("scheduled_at", nowIso)
    .select("id, lead_id")
    .maybeSingle();
  if (updateErr) return { released: false, reason: "update_error" };
  if (!updated) return { released: false, reason: "update_missed" };

  const lead = one(showing.lead);
  const property = one(showing.property);
  const agent = one(showing.assigned_agent);
  const tz = args.org.booking_timezone || "America/Toronto";
  const whenLabel = formatSlotLong(showing.scheduled_at, tz);
  const address = property?.address?.trim() || "the property";
  const noteBody =
    args.noteBody ??
    `Viewing released because it was still unconfirmed ${whenLabel}.`;

  if (showing.lead_id) {
    await client.from("messages").insert({
      organization_id: args.org.id,
      lead_id: showing.lead_id,
      channel: "note",
      direction: "outbound",
      body: noteBody,
    });
  }

  await sendShowingAutoReleased({
    renter_name: lead?.name ?? null,
    renter_email: lead?.email ?? null,
    org_name: args.org.name,
    brand_color: args.org.brand_color,
    logo_url: args.org.logo_url,
    reply_to_email: args.org.reply_to_email,
    property_address: property?.address ?? null,
    when_label: whenLabel,
    renter_url: property?.id ? `${args.appUrl}/r/${property.id}` : null,
  });

  await sendOrgNotification({
    client,
    org: {
      id: args.org.id,
      name: args.org.name,
      brand_color: args.org.brand_color,
      logo_url: args.org.logo_url,
      reply_to_email: args.org.reply_to_email,
    },
    eventKey: "leasing.showing_auto_released",
    audienceEmail: agent?.email ?? null,
    operatorFallback: [args.org.reply_to_email, args.org.public_contact_email]
      .filter((email): email is string => typeof email === "string" && email.includes("@"))
      .slice(0, 2),
    vars: {
      org_name: args.org.name ?? "",
      property_address: address,
      lead_name: lead?.name?.trim() || lead?.email?.trim() || "A renter",
      agent_name: agent?.name?.trim() || "there",
      showing_time: whenLabel,
      dashboard_url: showing.lead_id
        ? `${args.appUrl}/dashboard/leads/${showing.lead_id}`
        : `${args.appUrl}/dashboard/showings`,
    },
    action: {
      label: showing.lead_id ? "Open the inquiry" : "Open viewings",
      url: showing.lead_id
        ? `${args.appUrl}/dashboard/leads/${showing.lead_id}`
        : `${args.appUrl}/dashboard/showings`,
    },
  });

  return { released: true };
}

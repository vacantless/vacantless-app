// S721: env + database half of "Add to calendar" (pure half: lib/viewing-calendar.ts).
import { createAdminClient } from "@/lib/supabase/admin";
import {
  signViewingCalendarToken,
  verifyViewingCalendarToken,
  type CalendarViewing,
} from "@/lib/viewing-calendar";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(/\/+$/, "");

function secret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CRON_SECRET || "";
}

/** The "Add to calendar" page for a viewing, or "" when the server has no key. */
export function viewingCalendarUrl(showingId: string | null | undefined): string {
  const s = secret();
  if (!showingId || !s) return "";
  return `${APP_URL}/showing/calendar/${signViewingCalendarToken(showingId, s)}`;
}

export type LoadedCalendarViewing = CalendarViewing & {
  outcome: string | null;
  timeZone: string;
  propertyId: string | null;
  org: {
    name: string | null;
    brand_color: string | null;
    brand_color_secondary: string | null;
    logo_url: string | null;
  } | null;
};

export async function loadCalendarViewing(token: string): Promise<LoadedCalendarViewing | null> {
  const id = verifyViewingCalendarToken(token, secret());
  if (!id) return null;
  const admin = createAdminClient();
  if (!admin) return null;
  const { data } = await admin
    .from("showings")
    .select(
      "id, scheduled_at, outcome, property_id, " +
        "organization:organizations(name, brand_color, brand_color_secondary, logo_url, booking_timezone, booking_slot_minutes), " +
        "lead:leads(name), property:properties(address)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as {
    id: string;
    scheduled_at: string | null;
    outcome: string | null;
    property_id: string | null;
    organization: {
      name: string | null;
      brand_color: string | null;
      brand_color_secondary: string | null;
      logo_url: string | null;
      booking_timezone: string | null;
      booking_slot_minutes: number | null;
    } | null;
    lead: { name: string | null } | null;
    property: { address: string | null } | null;
  };
  if (!row.scheduled_at) return null;
  return {
    showingId: row.id,
    startIso: row.scheduled_at,
    minutes: row.organization?.booking_slot_minutes || 30,
    address: row.property?.address ?? null,
    orgName: row.organization?.name ?? null,
    renterName: row.lead?.name ?? null,
    cancelled: row.outcome === "cancelled",
    pageUrl: `${APP_URL}/showing/calendar/${token.trim().toLowerCase()}`,
    outcome: row.outcome,
    timeZone: row.organization?.booking_timezone || "America/Toronto",
    propertyId: row.property_id,
    org: row.organization
      ? {
          name: row.organization.name,
          brand_color: row.organization.brand_color,
          brand_color_secondary: row.organization.brand_color_secondary,
          logo_url: row.organization.logo_url,
        }
      : null,
  };
}

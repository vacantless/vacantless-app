"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { timeStrToMinutes } from "@/lib/booking";

const COMMON_TZ = new Set([
  "America/Toronto",
  "America/Vancouver",
  "America/Edmonton",
  "America/Winnipeg",
  "America/Halifax",
  "America/St_Johns",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
]);

export async function updateBookingSettings(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) return;
  // Viewing settings are admin/operator only (locked seat model).
  await requireCapability("manage_availability", "/dashboard/availability?forbidden=1");

  const tz = String(formData.get("timezone") ?? "").trim();
  const slot = Number(formData.get("slot_minutes"));
  const lead = Number(formData.get("lead_hours"));
  const horizon = Number(formData.get("horizon_days"));

  const update: Record<string, string | number> = {};
  if (COMMON_TZ.has(tz)) update.booking_timezone = tz;
  if ([15, 20, 30, 45, 60].includes(slot)) update.booking_slot_minutes = slot;
  if (Number.isFinite(lead) && lead >= 0 && lead <= 168)
    update.booking_lead_hours = Math.round(lead);
  if (Number.isFinite(horizon) && horizon >= 1 && horizon <= 60)
    update.booking_horizon_days = Math.round(horizon);

  if (Object.keys(update).length > 0) {
    const supabase = createClient();
    await supabase.from("organizations").update(update).eq("id", org.id);
  }

  revalidatePath("/dashboard/availability");
}

// Showing clustering ("Hero blocks"). Opt-in: when on, the public booking page
// steers new renters toward time slots near a building's existing showings so
// visits group per building per day (less travel between viewings).
export async function updateClusteringSettings(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) return;
  // Viewing settings are admin/operator only (locked seat model).
  await requireCapability("manage_availability", "/dashboard/availability?forbidden=1");

  const enabled = formData.get("clustering_enabled") === "on";
  const buffer = Number(formData.get("clustering_buffer_minutes"));
  const capacity = Number(formData.get("showing_block_capacity"));

  const update: Record<string, string | number | boolean> = {
    clustering_enabled: enabled,
  };
  if (Number.isFinite(buffer) && buffer >= 0 && buffer <= 480)
    update.clustering_buffer_minutes = Math.round(buffer);
  if (Number.isFinite(capacity) && capacity >= 1 && capacity <= 50)
    update.showing_block_capacity = Math.round(capacity);

  const supabase = createClient();
  await supabase.from("organizations").update(update).eq("id", org.id);

  revalidatePath("/dashboard/availability");
  revalidatePath("/dashboard/showings");
}

export async function addAvailabilityWindow(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) return;
  // Viewing settings are admin/operator only (locked seat model).
  await requireCapability("manage_availability", "/dashboard/availability?forbidden=1");

  const weekday = Number(formData.get("weekday"));
  const start = timeStrToMinutes(String(formData.get("start") ?? ""));
  const end = timeStrToMinutes(String(formData.get("end") ?? ""));

  if (
    !Number.isInteger(weekday) ||
    weekday < 0 ||
    weekday > 6 ||
    start == null ||
    end == null ||
    end <= start
  ) {
    return; // invalid input — ignore; form re-renders unchanged
  }

  const supabase = createClient();
  await supabase.from("availability_rules").insert({
    organization_id: org.id,
    weekday,
    start_minute: start,
    end_minute: end,
  });

  revalidatePath("/dashboard/availability");
  revalidatePath("/dashboard");
}

export async function deleteAvailabilityWindow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await requireCapability("manage_availability", "/dashboard/availability?forbidden=1");
  const supabase = createClient();
  // RLS scopes the delete to the caller's org.
  await supabase.from("availability_rules").delete().eq("id", id);
  revalidatePath("/dashboard/availability");
  revalidatePath("/dashboard");
}

// Date-specific day off (S398). Blocks a single calendar date on top of the
// recurring weekly windows — for a rotating day off (e.g. an operator's second
// job) that changes week to week, so removing the whole weekday would be wrong.
export async function addDayOff(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) return;
  await requireCapability("manage_availability", "/dashboard/availability?forbidden=1");

  const day = String(formData.get("day") ?? "").trim();
  // Accept only a real YYYY-MM-DD calendar date, today or later (a past
  // blackout can never affect a bookable slot). Round-trip through Date to
  // reject impossible dates like 2026-02-30.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return;
  if (parsed.toISOString().slice(0, 10) !== day) return; // normalized mismatch => invalid
  // Compare against "today" in the org's booking timezone, matching the UI's
  // date-input minimum (page.tsx todayKey). Using UTC here would, in North
  // American evening hours, reject a valid same-local-day blackout the UI still
  // offers (UTC has already rolled to tomorrow).
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: org.booking_timezone || "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (day < todayKey) return;

  const supabase = createClient();
  // Idempotent: the unique (organization_id, day) index means a repeat add is a
  // no-op rather than an error. RLS scopes the write to the caller's org.
  await supabase
    .from("availability_days_off")
    .upsert(
      { organization_id: org.id, day },
      { onConflict: "organization_id,day", ignoreDuplicates: true },
    );

  revalidatePath("/dashboard/availability");
  revalidatePath("/dashboard");
}

export async function removeDayOff(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await requireCapability("manage_availability", "/dashboard/availability?forbidden=1");
  const supabase = createClient();
  // RLS scopes the delete to the caller's org.
  await supabase.from("availability_days_off").delete().eq("id", id);
  revalidatePath("/dashboard/availability");
  revalidatePath("/dashboard");
}

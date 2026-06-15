"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
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

export async function addAvailabilityWindow(formData: FormData) {
  const org = await getCurrentOrg();
  if (!org) return;

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
  const supabase = createClient();
  // RLS scopes the delete to the caller's org.
  await supabase.from("availability_rules").delete().eq("id", id);
  revalidatePath("/dashboard/availability");
  revalidatePath("/dashboard");
}

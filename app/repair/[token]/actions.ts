"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { timeStrToMinutes } from "@/lib/booking";
import {
  validateDayWindow,
  normalizeWindows,
  dedupeWindows,
  pickWindowsByKeys,
  isTenantScheduleLinkExpired,
  type DayWindow,
} from "@/lib/repair-scheduling";

// ============================================================================
// Public tenant pick-your-times submit (repair-scheduling Slice 3). The person
// opening the link has NO Vacantless session — the token IS the credential. We
// look the appointment up by tenant_access_token using the service-role admin
// client (an anon caller can't satisfy RLS) and only ever touch THAT one row's
// tenant_availability. Non-destructive: the worst a token holder can do is set
// availability windows on their own appointment, which a logged-in operator then
// reconciles + confirms. No PII is written (date + minute windows only).
// ============================================================================

function path(token: string, status?: string): string {
  const base = `/repair/${encodeURIComponent(token)}`;
  return status ? `${base}?status=${status}` : base;
}

export async function submitTenantAvailability(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) redirect("/repair/invalid?status=invalid");

  const admin = createAdminClient();
  if (!admin) redirect(path(token, "error"));

  const { data: row } = await admin
    .from("work_order_appointments")
    .select("id, supplier_windows, token_expires_at, status")
    .eq("tenant_access_token", token)
    .maybeSingle();
  if (!row) redirect(path(token, "invalid"));
  const r = row as {
    id: string;
    supplier_windows: unknown;
    token_expires_at: string | null;
    status: string;
  };
  if (isTenantScheduleLinkExpired(r.token_expires_at)) redirect(path(token, "expired"));

  // Build availability from the supplier windows the tenant ticked, plus an
  // optional free-form "other time I'm free" row.
  const supplier = normalizeWindows(Array.isArray(r.supplier_windows) ? (r.supplier_windows as DayWindow[]) : []);
  const checkedKeys = formData.getAll("win").map((v) => String(v));
  const picked = pickWindowsByKeys(supplier, checkedKeys);

  const customDate = String(formData.get("custom_date") ?? "").trim();
  const customStart = timeStrToMinutes(String(formData.get("custom_start") ?? ""));
  const customEnd = timeStrToMinutes(String(formData.get("custom_end") ?? ""));
  const hasCustom = customDate !== "" || customStart != null || customEnd != null;

  let availability = picked;
  if (hasCustom) {
    const v = validateDayWindow({
      date: customDate,
      start_minute: customStart ?? -1,
      end_minute: customEnd ?? -1,
    });
    if (v.ok) availability = dedupeWindows([...picked, v.value]);
    else if (picked.length === 0) redirect(path(token, "badtime"));
    // a malformed custom row with valid ticks just saves the ticks
  }

  if (availability.length === 0) redirect(path(token, "empty"));

  const { error } = await admin
    .from("work_order_appointments")
    .update({ tenant_availability: availability, updated_at: new Date().toISOString() })
    .eq("id", r.id);
  if (error) redirect(path(token, "error"));

  redirect(path(token, "submitted"));
}

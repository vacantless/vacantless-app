"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { crewFromToken, recordCrewTap } from "@/lib/unit-progress-server";

// S788b: a tap on a crew link (/crew/<token>). No Vacantless session: the
// token is the handle. POST only (a server action), so link scanners that
// fetch the page can never change a stage (KI585).
function back(token: string, status: string, unit?: string): string {
  const q = new URLSearchParams({ status });
  if (unit) q.set("unit", unit);
  return `/crew/${encodeURIComponent(token)}?${q.toString()}`;
}

export async function tapStageFromCrewLink(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const propertyId = String(formData.get("property_id") ?? "").trim();
  const stage = String(formData.get("stage") ?? "").trim();
  if (!token || !propertyId || !stage) redirect("/crew/invalid");

  const admin = createAdminClient();
  if (!admin) redirect(back(token, "error"));
  const crew = await crewFromToken(admin, token);
  if (!crew) redirect("/crew/invalid");

  const result = await recordCrewTap({ admin, crew, propertyId, stage, note: formData.get("note"), dueDate: formData.get("due_date") });
  if (!result.ok) redirect(back(token, result.reason === "not_allowed" ? "not_allowed" : "error", propertyId));
  redirect(back(token, `saved_${result.stage}`, propertyId));
}

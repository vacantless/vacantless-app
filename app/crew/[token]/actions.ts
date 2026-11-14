"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { addUnitFromCrew, crewFromToken, recordCrewTap } from "@/lib/unit-progress-server";

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

  const result = await recordCrewTap({ admin, crew, propertyId, stage, note: formData.get("note"), dueDate: formData.get("due_date"), photoFolder: formData.get("photo_folder"), photographerName: formData.get("photographer_name") });
  if (!result.ok) redirect(back(token, result.reason === "not_allowed" ? "not_allowed" : "error", propertyId));
  // S789b: say how the photo pull went on the saved banner.
  const url = new URL(back(token, `saved_${result.stage}`, propertyId), "https://x");
  if (result.photos) url.searchParams.set("photos", result.photos.ok ? `added_${result.photos.added}` : result.photos.reason);
  redirect(`${url.pathname}${url.search}`);
}

export async function addUnitFromCrewLink(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) redirect("/crew/invalid");
  const admin = createAdminClient();
  if (!admin) redirect(back(token, "error"));
  const crew = await crewFromToken(admin, token);
  if (!crew) redirect("/crew/invalid");
  const result = await addUnitFromCrew({
    admin,
    crew,
    street: String(formData.get("street") ?? "").trim(),
    unit: formData.get("unit"),
    stage: String(formData.get("stage") ?? "").trim() || undefined,
    dueDate: formData.get("due_date"),
  });
  if (!result.ok) redirect(back(token, `add_${result.reason}`));
  redirect(back(token, result.existed ? "add_existed" : "added", result.propertyId));
}

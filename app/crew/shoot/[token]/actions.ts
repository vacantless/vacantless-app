"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordShootPhotosIn, shootFromToken } from "@/lib/photo-shoot-server";

// S791a: the photographer's "Photos are in" on their one-time link. POST only
// (a server action), so a link scanner that fetches the page changes nothing.
function back(token: string, status: string, photos?: string): string {
  const q = new URLSearchParams({ status });
  if (photos) q.set("photos", photos);
  return `/crew/shoot/${encodeURIComponent(token)}?${q.toString()}`;
}

export async function photosInFromShootLink(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) redirect("/crew/invalid");
  const admin = createAdminClient();
  if (!admin) redirect(back(token, "error"));
  const shoot = await shootFromToken(admin, token);
  if (!shoot) redirect("/crew/invalid");
  const result = await recordShootPhotosIn({ admin, shoot, folder: formData.get("photo_link") });
  if (!result.ok) redirect(back(token, result.reason));
  redirect(back(token, "done", result.photos ? (result.photos.ok ? `added_${result.photos.added}` : result.photos.reason) : undefined));
}

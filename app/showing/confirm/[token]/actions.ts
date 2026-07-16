"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { confirmShowingByCancelToken } from "@/lib/showing-confirmation";

function path(token: string, status: string): string {
  return `/showing/confirm/${encodeURIComponent(token)}?status=${status}`;
}

// Public, unauthenticated renter confirmation. The page GET only renders; this
// server action is the only write path so email link scanners cannot confirm.
export async function confirmShowingFromLeadToken(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) redirect("/showing/confirm/invalid?status=invalid");

  const admin = createAdminClient();
  if (!admin) redirect(path(token, "error"));

  const result = await confirmShowingByCancelToken(admin, token);
  redirect(path(token, result.ok ? "confirmed" : "error"));
}

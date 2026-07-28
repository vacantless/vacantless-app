"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  isUuidLike,
  parseRentConfirmSubmission,
} from "@/lib/rent-confirm-public";

function path(token: string, status: string): string {
  return `/confirm-rent/${encodeURIComponent(token)}?status=${status}`;
}

export async function confirmRentFromToken(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token || !isUuidLike(token)) redirect("/confirm-rent/invalid?status=invalid");

  const parsed = parseRentConfirmSubmission({
    status: String(formData.get("status") ?? ""),
    currentRent: String(formData.get("current_rent") ?? ""),
    effectiveDate: String(formData.get("current_rent_effective_date") ?? ""),
  });
  if (!parsed.ok) redirect(path(token, "invalid"));

  const supabase = createClient();
  const { data, error } = await supabase.rpc("confirm_rent_from_token", {
    p_token: token,
    p_status: parsed.status,
    p_current_rent_cents: parsed.currentRentCents,
    p_effective_date: parsed.effectiveDate,
  });
  const result = data as { ok?: boolean; reason?: string } | null;
  if (error || !result?.ok) {
    const status =
      result?.reason === "not_found" || result?.reason === "bad_input"
        ? "invalid"
        : "error";
    redirect(path(token, status));
  }

  redirect(path(token, "done"));
}

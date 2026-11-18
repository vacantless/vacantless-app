"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// S816: an applicant accepts or declines an offer by typing their name. The
// SECURITY DEFINER sign_application_offer RPC (0304) re-checks everything and
// marks the offer accepted when the last applicant signs.
export async function signOffer(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return;
  const accept = String(formData.get("decision") ?? "") !== "decline";
  const signedName = String(formData.get("signed_name") ?? "").trim();
  const back = `/offer/${encodeURIComponent(token)}`;
  if (signedName.replace(/\s/g, "").length < 2) redirect(`${back}?error=signature_required`);
  if (accept && formData.get("agree") == null) redirect(`${back}?error=agree_required`);

  const h = headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  const supabase = createClient();
  const { data, error } = await supabase.rpc("sign_application_offer", {
    p_token: token,
    p_signed_name: signedName,
    p_accept: accept,
    p_ip: ip,
    p_user_agent: h.get("user-agent"),
  });
  const r = data as { ok?: boolean; reason?: string } | null;
  if (error || !r?.ok) redirect(`${back}?error=${r?.reason ?? "failed"}`);
  redirect(`${back}?done=${accept ? "signed" : "declined"}`);
}

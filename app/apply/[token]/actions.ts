"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  ALLOWED_FORM_FIELDS,
  validateSubmission,
  applicationConsentText,
  validateTypedSignature,
} from "@/lib/rental-application";

// Public applicant submit (S454 Slice 1; signed S816). Anon-callable through the
// SECURITY DEFINER submit_rental_application_signed RPC (migration 0304). We
// build form_data from the NON-SENSITIVE allowlist only (Model B: SIN/DOB/DL and
// income documents are never captured). S816: the applicant signs by typing
// their full legal name under the authorization; the exact words, time, IP and
// device are stored with the signature. The org name for the words is re-read
// from the token server-side, never trusted from the post.
export async function submitRentalApplication(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return;
  const back = (e: string) => redirect(`/apply/${token}?error=${encodeURIComponent(e)}`);

  const name = String(formData.get("applicant_name") ?? "").trim();
  const email = String(formData.get("applicant_email") ?? "").trim();
  const phone = String(formData.get("applicant_phone") ?? "").trim();
  const signedName = String(formData.get("signed_name") ?? "").trim();
  const agreed = formData.get("agree") != null;

  const form: Record<string, string> = {};
  for (const key of ALLOWED_FORM_FIELDS) {
    const raw = formData.get(key);
    if (raw == null) continue;
    const val = String(raw).trim();
    if (val) form[key] = val;
  }

  const v = validateSubmission({ consent: agreed, applicant_name: name, applicant_email: email, applicant_phone: phone });
  if (!v.ok) back(v.errors[0]);
  const sig = validateTypedSignature(signedName, name);
  if (!sig.ok) back(sig.reason);

  const supabase = createClient();
  const { data: shell } = await supabase.rpc("get_rental_application_by_token", { p_token: token });
  const orgName = (shell as { org_name?: string | null } | null)?.org_name ?? null;

  const h = headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;

  const { data, error } = await supabase.rpc("submit_rental_application_signed", {
    p_token: token,
    p_form_data: form,
    p_signed_name: signedName,
    p_consent_text: applicationConsentText(orgName),
    p_applicant_name: name,
    p_applicant_email: email || null,
    p_applicant_phone: phone || null,
    p_ip: ip,
    p_user_agent: h.get("user-agent"),
  });
  if (error) back("server");
  const res = data as { ok?: boolean; reason?: string } | null;
  if (!res?.ok) back(res?.reason ?? "failed");
  redirect(`/apply/${token}?submitted=1`);
}

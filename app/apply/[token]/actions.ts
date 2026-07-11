"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ALLOWED_FORM_FIELDS, validateSubmission } from "@/lib/rental-application";

// Public applicant submit (S454, Slice 1). Anon-callable through the SECURITY
// DEFINER submit_rental_application RPC (migration 0125). We build form_data from
// the NON-SENSITIVE allowlist only — a belt to the RPC's SQL-level sensitive-key
// strip (Model B: SIN/DOB/DL/income-docs are never captured here). Consent is
// mandatory (the credit pull can't be authorized without it).
export async function submitRentalApplication(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return;

  const consent = formData.get("consent") != null;
  const name = String(formData.get("applicant_name") ?? "").trim();
  const email = String(formData.get("applicant_email") ?? "").trim();
  const phone = String(formData.get("applicant_phone") ?? "").trim();

  // Allowlist-only projection of the submitted fields (never trust the raw post).
  const form: Record<string, string> = {};
  for (const key of ALLOWED_FORM_FIELDS) {
    const raw = formData.get(key);
    if (raw == null) continue;
    const val = String(raw).trim();
    if (val) form[key] = val;
  }

  const v = validateSubmission({
    consent,
    applicant_name: name,
    applicant_email: email,
    applicant_phone: phone,
  });
  if (!v.ok) {
    redirect(`/apply/${token}?error=${encodeURIComponent(v.errors[0])}`);
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("submit_rental_application", {
    p_token: token,
    p_form_data: form,
    p_consent: consent,
    p_applicant_name: name || null,
    p_applicant_email: email || null,
    p_applicant_phone: phone || null,
  });
  if (error) {
    redirect(`/apply/${token}?error=server`);
  }
  const res = data as { ok?: boolean; reason?: string } | null;
  if (!res?.ok) {
    redirect(`/apply/${token}?error=${encodeURIComponent(res?.reason ?? "failed")}`);
  }
  redirect(`/apply/${token}?submitted=1`);
}

"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { validateSignature } from "@/lib/lease-signing";

// Public, unauthenticated signature submission (lease vault #11, slice 4). Calls
// the SECURITY DEFINER sign_lease_document RPC, which re-validates EVERY rule
// server-side and atomically flips the lease to 'executed' once the last signer
// signs. We validate here too (fast feedback) but the RPC is the source of
// truth — the anon-RPC re-validate rule. Verifiability fields (IP + user-agent)
// are read from the request headers and captured by the RPC.
export async function submitSignature(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return;

  const signedName = String(formData.get("signed_name") ?? "");
  const signatureKind = String(formData.get("signature_kind") ?? "");
  const signatureData = String(formData.get("signature_data") ?? "");
  const back = `/sign/${encodeURIComponent(token)}`;

  const check = validateSignature({
    signedName,
    consent: true, // the submit button is gated on consent client-side
    signatureKind,
    signatureData,
  });
  if (!check.ok) redirect(`${back}?error=${check.reason}`);

  const h = headers();
  // first hop of x-forwarded-for is the client; fall back to x-real-ip.
  const ip =
    (h.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    h.get("x-real-ip") ||
    null;
  const userAgent = h.get("user-agent");

  const supabase = createClient();
  const { data, error } = await supabase.rpc("sign_lease_document", {
    p_token: token,
    p_signed_name: signedName,
    p_signature_kind: signatureKind,
    p_signature_data: signatureData,
    p_consent: true,
    p_ip: ip,
    p_user_agent: userAgent,
  });

  const result = data as { ok?: boolean; reason?: string } | null;
  if (error || !result?.ok) {
    redirect(`${back}?error=${result?.reason ?? "failed"}`);
  }

  redirect(`${back}?signed=1`);
}

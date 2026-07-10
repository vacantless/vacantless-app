import { type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { planEmailConfirm } from "@/lib/auth-confirm";

// Verifier-free finalizer for recovery / signup / invite / magic-link emails.
//
// The email templates point here with ?token_hash=...&type=...&next=..., and we
// verify the hashed OTP server-side (verifyOtp). Unlike the PKCE ?code path in
// /auth/callback - which needs a code_verifier in the *requesting* browser and
// therefore dies in the Gmail in-app browser / on a second device / under an
// email scanner's pre-fetch - this works from any browser or device. The
// implicit #hash flow in /auth/callback stays for operator-provisioned links.
//
// On success we forward to `next` (the server client has written the session to
// cookies). On any failure we bounce to /auth/callback#error, which already
// renders the "This link didn't work - request a new link" screen.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const plan = planEmailConfirm({
    token_hash: searchParams.get("token_hash"),
    type: searchParams.get("type"),
    next: searchParams.get("next"),
  });

  const FAIL = "/auth/callback#error=link_invalid";
  if (!plan.ok) redirect(FAIL);

  const supabase = createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: plan.type,
    token_hash: plan.token_hash,
  });
  if (error) redirect(FAIL);

  redirect(plan.next);
}

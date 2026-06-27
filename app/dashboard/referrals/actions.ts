"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { validateReferralFriend, buildReferralLink } from "@/lib/referrals";

// Landlord-initiated referral (Slice 2). Inserts a PENDING org_invites row
// attributed to the caller's own org via the AUTHED client — RLS policy
// org_invites_insert_referral enforces source='referral' + status='pending' +
// referred_by_user_id=auth.uid() + referred_by_org_id in user_org_ids() + no
// provisioned fields, so the insert is doubly constrained (here + in SQL). The
// elevated accept-flip happens later, server-side, when the friend signs up
// (lib/referrals-server.acceptReferral via the service-role client).
//
// Returns the shareable link so the client form can show + copy it.

export type CreateReferralResult =
  | { ok: true; link: string }
  | { ok: false; error: string };

/** A 192-bit url-safe handle (the share/signing/provisioning token pattern). */
function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function createReferralAction(
  input: { email?: string | null; name?: string | null; origin: string },
): Promise<CreateReferralResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  const org = await getCurrentOrg();
  if (!org) return { ok: false, error: "No organization found for your account." };

  const clean = validateReferralFriend({ email: input.email, name: input.name });
  if (!clean.ok) return { ok: false, error: clean.error };

  const token = newToken();
  const { error } = await supabase.from("org_invites").insert({
    invited_email: clean.value.email,
    invited_name: clean.value.name,
    status: "pending",
    source: "referral",
    referred_by_org_id: org.id,
    referred_by_user_id: user.id,
    token,
  });

  if (error) {
    return { ok: false, error: "Could not create the referral link. Please try again." };
  }

  revalidatePath("/dashboard/referrals");
  // The origin is captured client-side so the link matches however the landlord
  // reached the app; lib/email's APP_URL is the server-side fallback elsewhere.
  return { ok: true, link: buildReferralLink(input.origin, token) };
}

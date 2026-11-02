"use server";

// S744 (roadmap item 14): accept a team invite. The service-role writes in
// lib/team-server.ts only run after checkAccept: the signed-in user's
// CONFIRMED email must equal the invited email.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { acceptTeamInvite, inviteById, inviteByToken, type InviteForJoin } from "@/lib/team-server";
import { writeSelectedOrgCookie } from "@/lib/selected-org";

async function accept(invite: InviteForJoin | null, back: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(back)}`);
  const result = await acceptTeamInvite({
    invite,
    userId: user.id,
    userEmail: user.email,
    emailConfirmed: user.email_confirmed_at != null,
  });
  if (!result.ok) {
    if (result.reason === "already_member" && invite) {
      writeSelectedOrgCookie(invite.organization_id);
      redirect("/dashboard");
    }
    redirect(`${back}${back.includes("?") ? "&" : "?"}e=${result.reason}`);
  }
  // Open the account they just joined, even if they also have their own.
  writeSelectedOrgCookie(result.orgId);
  redirect("/dashboard?joined=1");
}

export async function acceptInviteByToken(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  await accept(await inviteByToken(token), `/join/${encodeURIComponent(token)}`);
}

/** From onboarding: a signed-in person with no account yet joins by invite id. */
export async function acceptInviteById(formData: FormData) {
  const id = String(formData.get("invite_id") ?? "");
  await accept(await inviteById(id), "/onboarding");
}

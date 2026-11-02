"use server";

// S744 (roadmap item 14): Settings > Team. Owner-only (manage_team), checked
// before any service-role call in lib/team-server.ts.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { createTeamInvite, removeTeamMember, revokeTeamInvite } from "@/lib/team-server";
import { sendTeamInvite } from "@/lib/email";
import { teamRoleLabel } from "@/lib/team";

const BACK = "/dashboard/settings?tab=team";
const FORBIDDEN = `${BACK}&team=forbidden`;

export async function inviteTeammate(formData: FormData) {
  await requireCapability("manage_team", FORBIDDEN);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = String(formData.get("role") ?? "operator");
  const result = await createTeamInvite({
    orgId: org.id,
    plan: org.plan,
    email: String(formData.get("email") ?? ""),
    role,
    invitedBy: user.id,
  });
  if (!result.ok) redirect(`${BACK}&team=${result.reason}`);

  const sent = await sendTeamInvite({
    to_email: result.email,
    org_name: org.name,
    inviter_email: user.email ?? null,
    role_label: teamRoleLabel(role),
    token: result.token,
    brand_color: org.brand_color,
    reply_to_email: org.reply_to_email || user.email || null,
  });
  redirect(`${BACK}&team=${sent.sent ? "sent" : "email_failed"}`);
}

export async function cancelTeamInvite(formData: FormData) {
  await requireCapability("manage_team", FORBIDDEN);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const ok = await revokeTeamInvite(org.id, String(formData.get("invite_id") ?? ""));
  redirect(`${BACK}&team=${ok ? "cancelled" : "error"}`);
}

export async function removeTeammate(formData: FormData) {
  await requireCapability("manage_team", FORBIDDEN);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const result = await removeTeamMember({
    orgId: org.id,
    membershipId: String(formData.get("membership_id") ?? ""),
    callerUserId: user.id,
  });
  redirect(`${BACK}&team=${result.ok ? "removed" : `remove_${result.reason}`}`);
}

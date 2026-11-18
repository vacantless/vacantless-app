"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";

// S816b: save a teammate's mobile. Anyone may set their own; an owner/admin
// (manage_team) may set anyone's on this account.
export async function saveTeammateMobile(formData: FormData) {
  const membershipId = String(formData.get("membership_id") ?? "");
  const mobile = String(formData.get("mobile") ?? "").trim().slice(0, 40) || null;
  if (!membershipId) return;
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = createAdminClient();
  if (!admin || !user) redirect("/dashboard/numbers?team=error#team");
  const { data: row } = await admin!
    .from("memberships")
    .select("id, user_id, organization_id")
    .eq("id", membershipId)
    .eq("organization_id", org!.id)
    .maybeSingle();
  const m = row as { user_id: string } | null;
  if (!m) redirect("/dashboard/numbers?team=error#team");
  if (m!.user_id !== user!.id && !(await currentUserCan("manage_team"))) {
    redirect("/dashboard/numbers?team=forbidden#team");
  }
  if (mobile && mobile.replace(/\D+/g, "").length < 10) redirect("/dashboard/numbers?team=bad#team");
  await admin!.from("memberships").update({ mobile }).eq("id", membershipId);
  revalidatePath("/dashboard/numbers");
  redirect("/dashboard/numbers?team=saved#team");
}

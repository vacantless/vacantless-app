// S845: reads what lib/mark-rented needs (the robot's access and live sign-ins).
import type { SupabaseClient } from "@supabase/supabase-js";
import { readRobotPostingAccess } from "@/lib/robot-posting-access";
import { rentedPlan, type RentedPlanLine } from "@/lib/mark-rented";

export async function loadRentedPlan(args: {
  supabase: SupabaseClient;
  organizationId: string;
  propertyId: string;
  posts: { id: string; portal: string; status: string | null; url: string | null }[];
}): Promise<RentedPlanLine[]> {
  const { supabase, organizationId, propertyId, posts } = args;
  const [access, { data: sessions }] = await Promise.all([
    readRobotPostingAccess(supabase, organizationId, { rental: propertyId }),
    supabase.from("distribution_channel_session_status").select("channel, alive").eq("organization_id", organizationId).eq("alive", true),
  ]);
  return rentedPlan({
    posts,
    aliveChannels: ((sessions ?? []) as { channel: string }[]).map((s) => s.channel),
    postingAllowed: access.allowed,
  });
}

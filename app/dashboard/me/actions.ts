"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { validateCoverage } from "@/lib/showing-agents";

const BASE = "/dashboard/me";

export async function updateMyCoverage(formData: FormData) {
  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/onboarding");

  const { data: rows } = await supabase
    .from("showing_agents")
    .select("id")
    .eq("user_id", user.id)
    .eq("organization_id", org.id)
    .eq("archived", false)
    .limit(1);
  const agentId: string | null =
    (rows as { id: string }[] | null)?.[0]?.id ?? null;
  if (!agentId) redirect(`${BASE}?me=not_linked`);

  const check = validateCoverage({
    service_area: formData.get("service_area") as string | null,
    product_types: formData.getAll("product_types") as string[],
    weekly_capacity: formData.get("weekly_capacity") as string | null,
  });
  if (!check.ok) redirect(`${BASE}?me=${check.code}`);

  await supabase
    .from("showing_agents")
    .update({
      service_area: check.value.service_area,
      product_types: check.value.product_types,
      weekly_capacity: check.value.weekly_capacity,
    })
    .eq("id", agentId)
    .eq("user_id", user.id)
    .eq("organization_id", org.id);

  revalidatePath(BASE);
  redirect(`${BASE}?me=saved`);
}

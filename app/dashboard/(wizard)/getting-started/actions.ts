"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";

async function upsertOnboarding(values: {
  dismissed_at?: string;
  rail_step_done_at?: string;
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const now = new Date().toISOString();
  const supabase = createClient();
  const { error } = await supabase.from("organization_onboarding").upsert(
    {
      organization_id: org.id,
      updated_at: now,
      ...values,
    },
    { onConflict: "organization_id" },
  );

  if (error) {
    redirect("/dashboard/getting-started?wizard=save_error#rent-rail-step");
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/getting-started");
}

export async function markRailStepHandled() {
  await upsertOnboarding({ rail_step_done_at: new Date().toISOString() });
  redirect("/dashboard/getting-started?wizard=rail_done#rent-rail-step");
}

export async function dismissGettingStarted() {
  await upsertOnboarding({ dismissed_at: new Date().toISOString() });
  redirect("/dashboard?getting_started=dismissed");
}

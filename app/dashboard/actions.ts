"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function addProperty(formData: FormData) {
  const address = String(formData.get("address") ?? "").trim();
  const organizationId = String(formData.get("organization_id") ?? "");
  const rent = String(formData.get("rent") ?? "").trim();

  if (!address || !organizationId) return;

  const supabase = createClient();
  // organization_id is set explicitly; RLS WITH CHECK enforces it must be an
  // org the caller belongs to, so this can't write into another tenant.
  await supabase.from("properties").insert({
    organization_id: organizationId,
    address,
    rent_cents: rent ? Math.round(parseFloat(rent) * 100) : null,
  });

  revalidatePath("/dashboard");
}

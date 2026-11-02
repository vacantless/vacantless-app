"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { detailsFromForm } from "@/lib/standard-lease";

// S743: save the Standard Form details for one lease document. Only a draft can
// change: a sent or signed lease keeps what was sent.
export async function saveStandardLeaseDetails(formData: FormData) {
  await requireCapability("manage_tenancies");
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  const tenancyId = String(formData.get("tenancy_id") ?? "");
  const leaseId = String(formData.get("lease_id") ?? "");
  const back = `/dashboard/tenancies/${tenancyId}/lease/${leaseId}/standard`;
  const supabase = createClient();
  const { data: lease } = await supabase
    .from("lease_documents")
    .select("id, status")
    .eq("id", leaseId)
    .eq("tenancy_id", tenancyId)
    .maybeSingle();
  if (!lease) redirect(`/dashboard/tenancies/${tenancyId}`);
  if ((lease as { status: string }).status !== "draft") redirect(`${back}?saved=locked`);
  const details = detailsFromForm((n) => {
    const v = formData.get(n);
    return typeof v === "string" ? v : null;
  });
  const { error } = await supabase
    .from("lease_documents")
    .update({ standard_form: details })
    .eq("id", leaseId)
    .eq("tenancy_id", tenancyId);
  redirect(`${back}?saved=${error ? "error" : "1"}`);
}

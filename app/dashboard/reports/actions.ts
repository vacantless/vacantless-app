"use server";
// S818c: the landlord records what they paid a rental site, so Reports shows
// cost per renter and per booked viewing by site.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { COST_SITE_KEYS, parseDollarsToCents } from "@/lib/channel-costs";

const BACK = "/dashboard/reports";

function backTo(days: string, key: string) {
  const d = /^\d+$|^all$/.test(days) ? `days=${days}&` : "";
  return `${BACK}?${d}cost=${key}#site-costs`;
}

export async function addMarketingCost(formData: FormData) {
  await requireCapability("manage_settings", `${BACK}?forbidden=1`);
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  const days = String(formData.get("days") ?? "");
  const portal = String(formData.get("portal") ?? "");
  if (!(COST_SITE_KEYS as string[]).includes(portal)) redirect(backTo(days, "site"));
  const cents = parseDollarsToCents(String(formData.get("amount") ?? ""));
  if (!cents) redirect(backTo(days, "amount"));
  const rawDate = String(formData.get("spent_on") ?? "").trim();
  const spentOn = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : new Date().toISOString().slice(0, 10);
  // One text box: the site's name for Other, a note for every other site.
  const text = String(formData.get("label") ?? "").trim();
  const label = portal === "other" ? text.slice(0, 60) || null : null;
  const note = portal === "other" ? null : text.slice(0, 200) || null;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("marketing_costs").insert({
    organization_id: org.id,
    portal,
    label,
    amount_cents: cents,
    spent_on: spentOn,
    note,
    created_by: user?.id ?? null,
  });
  revalidatePath(BACK);
  redirect(backTo(days, error ? "error" : "saved"));
}

export async function removeMarketingCost(formData: FormData) {
  await requireCapability("manage_settings", `${BACK}?forbidden=1`);
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  const id = String(formData.get("cost_id") ?? "");
  const days = String(formData.get("days") ?? "");
  if (id) {
    const supabase = createClient();
    await supabase.from("marketing_costs").delete().eq("id", id).eq("organization_id", org.id);
  }
  revalidatePath(BACK);
  redirect(backTo(days, "removed"));
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { parseAmountToCents, parseDateOrNull } from "@/lib/payments";
import {
  validateWorkOrderInput,
  validateStatusChange,
  validateTradeContactInput,
  statusOffersTenantUpdate,
} from "@/lib/work-orders";
import { validateDirectoryListingInput, minimizeForDirectory } from "@/lib/directory";

// Maintenance work-order + trade-contact actions (self-managed-owner wedge,
// Slice 2 of the work-order module — see VACANTLESS-WORKORDERS-MODULE-SPEC).
//
// We record the owner's maintenance work; we never dispatch a trade or move
// money. Every action is guarded on the manage_work_orders capability
// (owner_admin + operator). Writes set organization_id from getCurrentOrg and
// rely on the per-org RLS WITH CHECK (migration 0054) as the backstop. Optional
// property/tenancy/trade FKs are confirmed to belong to the caller's org before
// they're stored (RLS scopes the lookups), so a forged id can't attach.
//
// REDIRECT-based, like payment-actions.ts (the S170 revalidate-503 WATCH).

const BASE = "/dashboard/maintenance";

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

// "" -> null; otherwise the trimmed value. Used for the optional UUID selects.
function orNull(formData: FormData, name: string): string | null {
  const v = s(formData, name);
  return v === "" ? null : v;
}

// Confirm an optional FK id belongs to the caller's org (RLS scopes the read).
// Returns true when the id is blank (nothing to attach) or it resolves to a row.
async function fkOk(
  supabase: ReturnType<typeof createClient>,
  table: "properties" | "tenancies" | "trade_contacts",
  id: string | null,
): Promise<boolean> {
  if (!id) return true;
  const { data } = await supabase.from(table).select("id").eq("id", id).maybeSingle();
  return !!data;
}

// --- Work orders ------------------------------------------------------------

export async function createWorkOrder(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?wo=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const check = validateWorkOrderInput({
    title: s(formData, "title"),
    category: s(formData, "category"),
    priority: s(formData, "priority"),
    costCents: parseAmountToCents(s(formData, "cost")),
  });
  if (!check.ok) redirect(`${BASE}?wo=${check.code}`);

  const supabase = createClient();
  const propertyId = orNull(formData, "property_id");
  const tenancyId = orNull(formData, "tenancy_id");
  const tradeContactId = orNull(formData, "trade_contact_id");

  if (
    !(await fkOk(supabase, "properties", propertyId)) ||
    !(await fkOk(supabase, "tenancies", tenancyId)) ||
    !(await fkOk(supabase, "trade_contacts", tradeContactId))
  ) {
    redirect(`${BASE}?wo=notfound`);
  }

  // A trade attached at creation means the job is at least "assigned".
  const status = tradeContactId ? "assigned" : "open";

  await supabase.from("work_orders").insert({
    organization_id: org.id,
    property_id: propertyId,
    tenancy_id: tenancyId,
    trade_contact_id: tradeContactId,
    title: check.value.title,
    description: s(formData, "description") || null,
    category: check.value.category,
    priority: check.value.priority,
    status,
    cost_cents: check.value.costCents,
    reported_on: parseDateOrNull(s(formData, "reported_on")) ?? undefined,
    scheduled_for: parseDateOrNull(s(formData, "scheduled_for")),
  });

  revalidatePath(BASE);
  redirect(`${BASE}?wo=created`);
}

export async function updateWorkOrder(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?wo=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const id = s(formData, "id");
  if (!id) redirect(BASE);

  const check = validateWorkOrderInput({
    title: s(formData, "title"),
    category: s(formData, "category"),
    priority: s(formData, "priority"),
    costCents: parseAmountToCents(s(formData, "cost")),
  });
  if (!check.ok) redirect(`${BASE}?wo=${check.code}`);

  const supabase = createClient();
  const propertyId = orNull(formData, "property_id");
  const tenancyId = orNull(formData, "tenancy_id");
  const tradeContactId = orNull(formData, "trade_contact_id");

  if (
    !(await fkOk(supabase, "properties", propertyId)) ||
    !(await fkOk(supabase, "tenancies", tenancyId)) ||
    !(await fkOk(supabase, "trade_contacts", tradeContactId))
  ) {
    redirect(`${BASE}?wo=notfound`);
  }

  // RLS scopes the update to the caller's org. status/completed_on are changed
  // only through setWorkOrderStatus (which validates the lifecycle).
  await supabase
    .from("work_orders")
    .update({
      property_id: propertyId,
      tenancy_id: tenancyId,
      trade_contact_id: tradeContactId,
      title: check.value.title,
      description: s(formData, "description") || null,
      category: check.value.category,
      priority: check.value.priority,
      cost_cents: check.value.costCents,
      scheduled_for: parseDateOrNull(s(formData, "scheduled_for")),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath(BASE);
  redirect(`${BASE}?wo=saved`);
}

export async function setWorkOrderStatus(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?wo=forbidden`);

  const id = s(formData, "id");
  const to = s(formData, "status");
  if (!id || !to) redirect(BASE);

  const supabase = createClient();
  const { data: row } = await supabase
    .from("work_orders")
    .select("status, completed_on, tenancy_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) redirect(`${BASE}?wo=notfound`);

  // When completing, take the completion date from the form (default today).
  const completedOn =
    to === "completed"
      ? (parseDateOrNull(s(formData, "completed_on")) ??
        new Date().toISOString().slice(0, 10))
      : null;

  const check = validateStatusChange(row.status as string, to, completedOn);
  if (!check.ok) redirect(`${BASE}?wo=${check.code}`);

  await supabase
    .from("work_orders")
    .update({
      status: check.value.status,
      completed_on: check.value.completedOn,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath(BASE);

  // Comms tie-in (Slice 4): when the job is tied to a tenancy and the new status
  // is one a tenant would want to hear about, surface a "let the tenant know"
  // offer on return — the maintenance page deep-links to that tenancy's message
  // composer with the matching maintenance template pre-loaded. We never send
  // automatically; the owner reviews and sends.
  const tenancyId = (row as { tenancy_id: string | null }).tenancy_id;
  if (tenancyId && statusOffersTenantUpdate(check.value.status)) {
    redirect(`${BASE}?wo=status&notify=${tenancyId}&to=${check.value.status}`);
  }
  redirect(`${BASE}?wo=status`);
}

export async function deleteWorkOrder(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?wo=forbidden`);

  const id = s(formData, "id");
  if (!id) redirect(BASE);

  const supabase = createClient();
  await supabase.from("work_orders").delete().eq("id", id);

  revalidatePath(BASE);
  redirect(`${BASE}?wo=deleted`);
}

// --- Trade contacts (the owner's own vendor rolodex) ------------------------

export async function createTradeContact(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?trade=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const check = validateTradeContactInput({
    name: s(formData, "name"),
    email: s(formData, "email") || null,
  });
  if (!check.ok) redirect(`${BASE}?trade=${check.code}`);

  const supabase = createClient();
  await supabase.from("trade_contacts").insert({
    organization_id: org.id,
    name: check.value.name,
    trade_type: s(formData, "trade_type") || null,
    phone: s(formData, "phone") || null,
    email: check.value.email,
    note: s(formData, "note") || null,
  });

  revalidatePath(BASE);
  redirect(`${BASE}?trade=created#trades`);
}

export async function updateTradeContact(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?trade=forbidden`);

  const id = s(formData, "id");
  if (!id) redirect(BASE);

  const check = validateTradeContactInput({
    name: s(formData, "name"),
    email: s(formData, "email") || null,
  });
  if (!check.ok) redirect(`${BASE}?trade=${check.code}`);

  const supabase = createClient();
  await supabase
    .from("trade_contacts")
    .update({
      name: check.value.name,
      trade_type: s(formData, "trade_type") || null,
      phone: s(formData, "phone") || null,
      email: check.value.email,
      note: s(formData, "note") || null,
    })
    .eq("id", id);

  revalidatePath(BASE);
  redirect(`${BASE}?trade=saved#trades`);
}

// Soft-hide a vendor (archived=true) so it drops out of the picker without
// breaking the cost history of past work orders that referenced it.
export async function archiveTradeContact(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?trade=forbidden`);

  const id = s(formData, "id");
  if (!id) redirect(BASE);
  const archived = s(formData, "archived") === "1";

  const supabase = createClient();
  await supabase.from("trade_contacts").update({ archived }).eq("id", id);

  revalidatePath(BASE);
  redirect(`${BASE}?trade=${archived ? "archived" : "restored"}#trades`);
}

// --- Trades directory: the local network (Slice 2) --------------------------
//
// The guardrail holds here exactly as it does for work orders: the owner stays
// the one who chooses, contracts, and pays. These actions only LIST a private
// trade into a cross-org phonebook (opt-in, revocable), pull it back, or COPY a
// network listing into the org's own rolodex. They never dispatch a trade and
// never move money. All three reuse manage_work_orders (same job: managing the
// owner's trades). Writes are org-scoped; the directory_trades RLS (0055) is the
// backstop, and the one cross-org write (used_count++) goes through the
// narrowly-scoped SECURITY DEFINER fn from 0056.

// List one of the org's private trades into the directory (opt-in consent).
// Copies only the minimized public fields across (minimizeForDirectory drops the
// private note); re-lists in place if it was promoted then unlisted before, so
// toggling never leaves duplicate rows.
export async function promoteTradeToDirectory(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?trade=forbidden#trades`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const tradeContactId = s(formData, "trade_contact_id");
  if (!tradeContactId) redirect(`${BASE}?dir=notfound#trades`);

  const supabase = createClient();
  // RLS scopes this read to the caller's org — a forged id resolves to nothing.
  const { data: trade } = await supabase
    .from("trade_contacts")
    .select("id, name, trade_type, phone, email")
    .eq("id", tradeContactId)
    .maybeSingle();
  if (!trade) redirect(`${BASE}?dir=notfound#trades`);

  const minimized = minimizeForDirectory({
    name: trade.name,
    trade_type: trade.trade_type,
    phone: trade.phone,
    email: trade.email,
    service_area: s(formData, "service_area"),
  });
  const check = validateDirectoryListingInput({
    businessName: minimized.businessName,
    tradeType: minimized.tradeType,
    serviceArea: minimized.serviceArea,
    blurb: s(formData, "blurb"),
    phone: minimized.phone,
    email: minimized.email,
  });
  if (!check.ok) redirect(`${BASE}?dir=${check.code}#trades`);

  // Owner may let contact details show before an add (default: hidden).
  const contactPublic = s(formData, "contact_public") === "1";

  // Re-list an existing (org, source trade) row instead of inserting a dup.
  const { data: existingRows } = await supabase
    .from("directory_trades")
    .select("id")
    .eq("contributed_by_org", org.id)
    .eq("source_trade_contact_id", tradeContactId)
    .eq("archived", false)
    .limit(1);
  const existing = existingRows?.[0];

  const fields = {
    business_name: check.value.businessName,
    trade_type: check.value.tradeType,
    service_area: check.value.serviceArea,
    blurb: check.value.blurb,
    phone: check.value.phone,
    email: check.value.email,
    contact_public: contactPublic,
    listed: true,
  };

  if (existing) {
    await supabase
      .from("directory_trades")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supabase.from("directory_trades").insert({
      source: "landlord",
      contributed_by_org: org.id,
      source_trade_contact_id: tradeContactId,
      ...fields,
    });
  }

  await supabase
    .from("trade_contacts")
    .update({ directory_opt_in: true })
    .eq("id", tradeContactId);

  revalidatePath(BASE);
  redirect(`${BASE}?dir=listed#trades`);
}

// Pull the org's listing(s) for a trade back out of the directory (consent is
// revocable). Own-org write (RLS); also clears the rolodex opt-in marker.
export async function unlistDirectoryTrade(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?trade=forbidden#trades`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const tradeContactId = s(formData, "trade_contact_id");
  if (!tradeContactId) redirect(`${BASE}#trades`);

  const supabase = createClient();
  await supabase
    .from("directory_trades")
    .update({ listed: false, updated_at: new Date().toISOString() })
    .eq("contributed_by_org", org.id)
    .eq("source_trade_contact_id", tradeContactId);

  await supabase
    .from("trade_contacts")
    .update({ directory_opt_in: false })
    .eq("id", tradeContactId);

  revalidatePath(BASE);
  redirect(`${BASE}?dir=unlisted#trades`);
}

// The core v1 verb: copy a network listing into the org's private rolodex. From
// there it behaves like any trade the owner added themselves (they call,
// schedule, and pay directly). Reveals contact on this explicit add, dedupes by
// name so a double-add neither duplicates nor inflates the use count, and bumps
// the listing's used_count through the SECURITY DEFINER fn (0056).
export async function addDirectoryTradeToRolodex(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?dir=forbidden#network`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const id = s(formData, "directory_trade_id");
  if (!id) redirect(`${BASE}#network`);

  const supabase = createClient();
  // The directory read policy returns any LISTED, non-archived row including its
  // contact (RLS gates rows, not columns — the browse view strips PII via
  // publicListingView; on an explicit add we DO copy the contact across).
  const { data: listing } = await supabase
    .from("directory_trades")
    .select(
      "id, business_name, trade_type, service_area, phone, email, listed, archived, contributed_by_org",
    )
    .eq("id", id)
    .maybeSingle();
  if (!listing || listing.listed !== true || listing.archived === true) {
    redirect(`${BASE}?dir=notfound#network`);
  }

  // An org's own listing is already in its rolodex — nothing to add.
  if (listing.contributed_by_org && listing.contributed_by_org === org.id) {
    redirect(`${BASE}?dir=own#network`);
  }

  // Honest dedupe: if the org already has a live rolodex entry with this name,
  // don't add a second or inflate the proof-loop count.
  const { data: dupes } = await supabase
    .from("trade_contacts")
    .select("id")
    .eq("organization_id", org.id)
    .eq("archived", false)
    .ilike("name", listing.business_name)
    .limit(1);
  if (dupes && dupes.length > 0) redirect(`${BASE}?dir=already_added#network`);

  await supabase.from("trade_contacts").insert({
    organization_id: org.id,
    name: listing.business_name,
    trade_type: listing.trade_type,
    phone: listing.phone,
    email: listing.email,
    note: listing.service_area
      ? `From the Vacantless trade network · ${listing.service_area}`
      : "From the Vacantless trade network",
  });

  // Proof-loop flywheel (cross-org write via the SECURITY DEFINER fn from 0056;
  // it re-checks listed + not-archived and ignores self-adds).
  await supabase.rpc("increment_directory_trade_use", { p_id: id });

  revalidatePath(BASE);
  redirect(`${BASE}?dir=added#trades`);
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import {
  isTenancyStatus,
  tenancyTakesUnitOffMarket,
  parseMoneyToCents,
  parseTermMonths,
  parseDateOrNull,
  buildTenantList,
  validateTenancyInput,
  MAX_TENANTS_PER_TENANCY,
} from "@/lib/tenancy";
import { normalizePhoneE164 } from "@/lib/sms";
import { resolvePersonId } from "@/lib/persons-server";
import {
  validateWatchLeaseInput,
  validateWatchExistingLease,
} from "@/lib/watch-lease";

const FORBIDDEN = "/dashboard/tenancies?forbidden=1";

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/** Today's date as YYYY-MM-DD (used as the default tenancy end date). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Pull the parallel tenant arrays + chosen primary index out of the form. */
function tenantArraysFrom(formData: FormData) {
  return {
    names: formData.getAll("tenant_name").map((v) => String(v)),
    emails: formData.getAll("tenant_email").map((v) => String(v)),
    phones: formData.getAll("tenant_phone").map((v) => String(v)),
    primaryIndex: parseInt(s(formData, "primary_index") || "0", 10) || 0,
  };
}

// ===========================================================================
// Create — used by both the standalone "Add tenancy" form and the lead
// "Convert to tenancy" flow (the convert page just prefills the same form).
// RLS WITH CHECK enforces organization_id; the FKs are the backstop.
// ===========================================================================
export async function createTenancy(formData: FormData) {
  await requireCapability("manage_tenancies", FORBIDDEN);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const propertyId = s(formData, "property_id") || null;
  const startDate = parseDateOrNull(s(formData, "start_date"));
  const endDate = parseDateOrNull(s(formData, "end_date"));
  const tenants = buildTenantList(tenantArraysFrom(formData));
  const fromLead = s(formData, "lead_id") || null;

  const check = validateTenancyInput({ propertyId, startDate, endDate, tenants });
  if (!check.ok) {
    const q = fromLead ? `from=${fromLead}&` : "";
    redirect(`/dashboard/tenancies/new?${q}err=${check.code}`);
  }

  const statusRaw = s(formData, "status");
  const status = isTenancyStatus(statusRaw) ? statusRaw : "active";

  const supabase = createClient();

  // Server-side guardrails (Codex QA, 2026-06-28). The form is RLS-scoped, but a
  // crafted POST could still pair the caller's org with a foreign property/lead,
  // or double-book a unit that already has a live tenancy. Re-validate here — the
  // page-level filtering is convenience; THIS is the enforcement.
  const guardFail = (code: string): never => {
    const q = fromLead ? `from=${fromLead}&` : "";
    redirect(`/dashboard/tenancies/new?${q}err=${code}`);
  };

  // 1. The property must belong to the caller's org (RLS scopes this SELECT, so
  //    a foreign property_id simply won't resolve).
  const { data: propRow } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .maybeSingle();
  if (!propRow) guardFail("property_not_found");

  // 2. A convert-flow lead must belong to the org and, if it names a unit, to
  //    the SAME unit this tenancy is for.
  if (fromLead) {
    const { data: leadRow } = await supabase
      .from("leads")
      .select("id, property_id")
      .eq("id", fromLead)
      .maybeSingle();
    if (!leadRow) guardFail("lead_not_found");
    const leadProp = (leadRow as { property_id: string | null }).property_id;
    if (leadProp && leadProp !== propertyId) guardFail("lead_mismatch");
  }

  // 3. No double-booking: a unit can hold at most one active/upcoming tenancy.
  //    (The DB also enforces one ACTIVE per property via a partial unique index;
  //    this catches upcoming overlaps and returns a friendly message.)
  const { data: liveTenancies } = await supabase
    .from("tenancies")
    .select("id")
    .eq("property_id", propertyId)
    .in("status", ["active", "upcoming"]);
  if ((liveTenancies ?? []).length > 0) guardFail("dup_tenancy");

  const { data: inserted } = await supabase
    .from("tenancies")
    .insert({
      organization_id: org.id,
      property_id: propertyId,
      lead_id: fromLead,
      rent_cents: parseMoneyToCents(s(formData, "rent")),
      deposit_cents: parseMoneyToCents(s(formData, "deposit")),
      start_date: startDate,
      end_date: endDate,
      term_months: parseTermMonths(s(formData, "term_months")),
      status,
      payment_notes: s(formData, "payment_notes") || null,
      move_in_notes: s(formData, "move_in_notes") || null,
      notes: s(formData, "notes") || null,
    })
    .select("id")
    .maybeSingle();

  const tenancyId = (inserted as { id: string } | null)?.id;
  if (!tenancyId) redirect("/dashboard/tenancies");

  // P1 status truth (Codex re-review S371): a unit with an active/upcoming
  // tenancy must not stay publicly bookable. The lifecycle rail already reads
  // tenancy truth, but every PUBLIC/SHARE/FEED surface (get_public_listing,
  // book_public_showing/submit_public_lead, the units picker, the syndication
  // feed RPC, the Rentals list chip + Copy-link) keys off properties.status —
  // so flip the unit to `leased` here, which closes all of them at once.
  //
  // Gated on the INSERTED tenancy's status (Codex re-review S371 follow-up): only
  // a current/forthcoming (active/upcoming) tenancy takes the unit off-market.
  // Recording a HISTORICAL (ended) tenancy on a currently-marketed rental must
  // NOT take it offline — this mirrors migration 0089's backfill condition.
  // The update is further guarded: org-scoped, and only from a publicly-exposed
  // state (available/paused). It deliberately leaves `off_market` alone so
  // watchLease's private units stay private, and `leased`/`draft` are already
  // non-bookable (no-op).
  if (tenancyTakesUnitOffMarket(status)) {
    await supabase
      .from("properties")
      .update({ status: "leased" })
      .eq("id", propertyId)
      .eq("organization_id", org.id)
      .in("status", ["available", "paused"]);
    revalidatePath(`/dashboard/properties/${propertyId}`);
    revalidatePath("/dashboard/properties");
  }

  // Insert the co-tenant child rows (buildTenantList guarantees exactly one
  // primary among them — the future Rotessa payer). Each is resolved to a
  // durable per-org person (the cross-tenancy vault identity) — sequentially so
  // two co-tenants sharing a contact key collapse to one person, not a race.
  const tenantRows: Array<Record<string, unknown>> = [];
  for (const t of tenants) {
    const phone_e164 = normalizePhoneE164(t.phone);
    const personId = await resolvePersonId(supabase, org.id, {
      name: t.name,
      email: t.email,
      phone: t.phone,
      phone_e164,
    });
    tenantRows.push({
      organization_id: org.id,
      tenancy_id: tenancyId,
      name: t.name,
      email: t.email,
      phone: t.phone,
      // Normalized match key for the inbound-STOP webhook (mirrors leads.phone_e164).
      phone_e164,
      is_primary: t.is_primary,
      person_id: personId,
    });
  }
  if (tenantRows.length > 0) {
    await supabase.from("tenants").insert(tenantRows);
  }

  revalidatePath("/dashboard/tenancies");
  revalidatePath("/dashboard");
  redirect(`/dashboard/tenancies/${tenancyId}?created=1`);
}

// ===========================================================================
// "Watch a lease" — the FREE compliance-wedge front door (rent-increase
// autopilot Slice 2, S340). An owner who is NOT on the leasing pipeline enrolls
// one existing lease into the rent-increase drip in a single screen.
//
// It writes the SAME records the autopilot already reads — no parallel model:
//   1. a lightweight PRIVATE unit (status=off_market, so it never appears on the
//      public /r renter page), carrying the owner-asserted exemption fact;
//   2. an ACTIVE tenancy on that unit with the lease start + last-increase date
//      (the inputs deriveRentIncrease / the cron / the N1 route consume);
//   3. the primary tenant, resolved to the durable per-org person vault.
//
// Notify-only: enrolling a lease never messages the tenant. The Slice 1 cron
// emails the OWNER to serve the N1 themselves (send-on-behalf is a later,
// approval-gated mode). Exemption is flag-don't-conclude: we store what the
// owner declares, never auto-determine rent-control status.
// ===========================================================================
export async function watchLease(formData: FormData) {
  // Creates a unit AND a tenancy, so it needs both capabilities. The
  // confirm-an-existing-tenancy path updates the SAME two records, so the same
  // pair of capabilities covers it.
  await requireCapability("manage_properties", FORBIDDEN);
  await requireCapability("manage_tenancies", FORBIDDEN);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  // --- Confirm-an-existing-tenancy (prefill) path ------------------------------
  // When the form carries a tenancy_id, the landlord is enrolling a lease that
  // ALREADY exists (created from the leasing pipeline) into the rent-increase
  // autopilot. The unit + parties are already on file, so we UPDATE the existing
  // tenancy + its property instead of creating duplicates — pure data reuse, no
  // new records. (The autopilot already sweeps every active tenancy; what's
  // missing for a pipeline tenancy is anyone setting the last-increase anchor +
  // the owner-asserted exemption, which only the watch form captured before.)
  const existingTenancyId = s(formData, "tenancy_id") || null;
  if (existingTenancyId) {
    await watchExistingTenancy(formData, org.id, existingTenancyId);
    return;
  }

  const address = s(formData, "address");
  const startDate = parseDateOrNull(s(formData, "start_date"));
  const lastIncreaseDate = parseDateOrNull(s(formData, "last_rent_increase_date"));
  const firstOccupancyDate = parseDateOrNull(s(formData, "first_occupancy_date"));
  const exempt = s(formData, "rent_control_exempt") === "on";
  const primaryName = s(formData, "tenant_name");

  const check = validateWatchLeaseInput({
    address,
    startDate,
    lastIncreaseDate,
    primaryTenantName: primaryName,
  });
  if (!check.ok) redirect(`/dashboard/tenancies/watch?err=${check.code}`);

  const rentCents = parseMoneyToCents(s(formData, "rent"));
  const supabase = createClient();

  // 1. The private unit. off_market keeps it off the public /r page — a watched
  //    lease is not being marketed. The exemption + its evidence date live here
  //    (a property fact), where the card/cron read them.
  const { data: prop } = await supabase
    .from("properties")
    .insert({
      organization_id: org.id,
      address,
      rent_cents: rentCents,
      status: "off_market",
      rent_control_exempt: exempt,
      first_occupancy_date: firstOccupancyDate,
    })
    .select("id")
    .maybeSingle();
  const propertyId = (prop as { id: string } | null)?.id;
  if (!propertyId) redirect("/dashboard/tenancies?forbidden=1");

  // 2. The active tenancy — the record the rent-increase autopilot sweeps.
  const { data: inserted } = await supabase
    .from("tenancies")
    .insert({
      organization_id: org.id,
      property_id: propertyId,
      rent_cents: rentCents,
      start_date: startDate,
      last_rent_increase_date: lastIncreaseDate,
      status: "active",
    })
    .select("id")
    .maybeSingle();
  const tenancyId = (inserted as { id: string } | null)?.id;
  if (!tenancyId) redirect("/dashboard/tenancies");

  // 3. The primary tenant (resolved to the durable per-org person vault).
  const email = s(formData, "tenant_email") || null;
  const phone = s(formData, "tenant_phone") || null;
  const phone_e164 = normalizePhoneE164(phone);
  const personId = await resolvePersonId(supabase, org.id, {
    name: primaryName,
    email,
    phone,
    phone_e164,
  });
  await supabase.from("tenants").insert({
    organization_id: org.id,
    tenancy_id: tenancyId,
    name: primaryName,
    email,
    phone,
    phone_e164,
    is_primary: true,
    person_id: personId,
  });

  revalidatePath("/dashboard/tenancies");
  revalidatePath("/dashboard");
  redirect(`/dashboard/tenancies/${tenancyId}?created=1&watch=1`);
}

// Confirm-an-existing-tenancy worker for watchLease (NOT a server action — it's
// an internal helper, so it isn't exported from this "use server" module). It
// writes the SAME records the autopilot already reads: the lease anchor on the
// tenancy + the owner-asserted exemption on its property. No new rows.
async function watchExistingTenancy(
  formData: FormData,
  orgId: string,
  tenancyId: string,
): Promise<never> {
  const supabase = createClient();

  // The tenancy must resolve under the caller's org. RLS scopes this SELECT, so
  // a foreign id simply won't come back — fail closed to the watch picker.
  const { data: tenancyRow } = await supabase
    .from("tenancies")
    .select("id, property_id")
    .eq("id", tenancyId)
    .maybeSingle();
  const propertyId = (tenancyRow as { id: string; property_id: string | null } | null)
    ?.property_id;
  if (!tenancyRow || !propertyId) {
    redirect("/dashboard/tenancies/watch?err=notfound");
  }

  const startDate = parseDateOrNull(s(formData, "start_date"));
  const lastIncreaseDate = parseDateOrNull(s(formData, "last_rent_increase_date"));
  const firstOccupancyDate = parseDateOrNull(s(formData, "first_occupancy_date"));
  const exempt = s(formData, "rent_control_exempt") === "on";

  const check = validateWatchExistingLease({ startDate, lastIncreaseDate });
  if (!check.ok) {
    redirect(`/dashboard/tenancies/watch?tenancy=${tenancyId}&err=${check.code}`);
  }

  // The lease anchor on the tenancy. Re-arm the autopilot: clearing the
  // once-per-cycle stamp lets the next sweep re-evaluate against the new
  // anniversary (recording a different last-increase date shifts the clock).
  const tenancyUpdate: Record<string, unknown> = {
    start_date: startDate,
    last_rent_increase_date: lastIncreaseDate,
    rent_increase_nudged_for: null,
    updated_at: new Date().toISOString(),
  };
  // Only touch rent when a value was actually entered, so a blanked field can't
  // silently null an existing rent.
  const rentCents = parseMoneyToCents(s(formData, "rent"));
  if (rentCents != null) tenancyUpdate.rent_cents = rentCents;

  await supabase
    .from("tenancies")
    .update(tenancyUpdate)
    .eq("id", tenancyId);

  // The owner-asserted exemption fact lives on the property (where the card +
  // cron read it). flag-don't-conclude: we store what the owner declares.
  await supabase
    .from("properties")
    .update({
      rent_control_exempt: exempt,
      first_occupancy_date: firstOccupancyDate,
    })
    .eq("id", propertyId)
    .eq("organization_id", orgId);

  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  revalidatePath("/dashboard/tenancies");
  revalidatePath("/dashboard");
  redirect(`/dashboard/tenancies/${tenancyId}?saved=1&watch=1`);
}

// ===========================================================================
// Record a rent increase you've served — the loop-closer for the rent-increase
// autopilot. The sweep nags until the increase is taken, but nothing rolled the
// anniversary forward once it was: this sets the new last-increase anchor (so
// next year's eligible date is anchor + 12mo), optionally bumps the stored rent
// to the new amount, and clears the once-per-cycle nudge stamp so the next sweep
// re-arms. One tap from the rent-increase card; no new rows, no migration.
// ===========================================================================
export async function recordRentIncrease(formData: FormData) {
  await requireCapability("manage_tenancies", FORBIDDEN);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const id = s(formData, "id");
  if (!id) redirect("/dashboard/tenancies");

  const effectiveDate = parseDateOrNull(s(formData, "effective_date"));
  if (!effectiveDate) redirect(`/dashboard/tenancies/${id}?increase=baddate`);

  const supabase = createClient();
  // Resolve org-scoped (RLS) and validate the new anchor against the lease start
  // — an effective date before the lease started would corrupt the clock.
  const { data: row } = await supabase
    .from("tenancies")
    .select("id, start_date")
    .eq("id", id)
    .maybeSingle();
  if (!row) redirect("/dashboard/tenancies");
  const startDate = (row as { start_date: string | null }).start_date;
  if (startDate && effectiveDate < startDate) {
    redirect(`/dashboard/tenancies/${id}?increase=before_start`);
  }

  const update: Record<string, unknown> = {
    last_rent_increase_date: effectiveDate,
    rent_increase_nudged_for: null,
    updated_at: new Date().toISOString(),
  };
  // Only bump rent when a new amount was entered; a blank field leaves the
  // stored rent untouched.
  const newRent = parseMoneyToCents(s(formData, "new_rent"));
  if (newRent != null) update.rent_cents = newRent;

  await supabase.from("tenancies").update(update).eq("id", id);

  revalidatePath(`/dashboard/tenancies/${id}`);
  revalidatePath("/dashboard/tenancies");
  revalidatePath("/dashboard");
  redirect(`/dashboard/tenancies/${id}?increase=recorded`);
}

// ===========================================================================
// Update core tenancy fields (not the tenant roster — that's add/remove below).
// ===========================================================================
export async function updateTenancy(formData: FormData) {
  await requireCapability("manage_tenancies", FORBIDDEN);
  const id = s(formData, "id");
  if (!id) return;

  const startDate = parseDateOrNull(s(formData, "start_date"));
  const endDate = parseDateOrNull(s(formData, "end_date"));
  if (!startDate) redirect(`/dashboard/tenancies/${id}?err=start`);
  if (endDate && endDate < startDate) redirect(`/dashboard/tenancies/${id}?err=dates`);

  const statusRaw = s(formData, "status");
  const status = isTenancyStatus(statusRaw) ? statusRaw : "active";

  const supabase = createClient();
  // RLS scopes the update to the caller's org; .eq("id") targets one row.
  await supabase
    .from("tenancies")
    .update({
      rent_cents: parseMoneyToCents(s(formData, "rent")),
      deposit_cents: parseMoneyToCents(s(formData, "deposit")),
      start_date: startDate,
      end_date: endDate,
      term_months: parseTermMonths(s(formData, "term_months")),
      status,
      payment_notes: s(formData, "payment_notes") || null,
      move_in_notes: s(formData, "move_in_notes") || null,
      notes: s(formData, "notes") || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath(`/dashboard/tenancies/${id}`);
  revalidatePath("/dashboard/tenancies");
  redirect(`/dashboard/tenancies/${id}?saved=1`);
}

// ===========================================================================
// End a tenancy — status -> ended + stamp an end date (defaults to today).
// ===========================================================================
export async function endTenancy(formData: FormData) {
  await requireCapability("manage_tenancies", FORBIDDEN);
  const id = s(formData, "id");
  if (!id) return;

  const endDate = parseDateOrNull(s(formData, "end_date")) ?? todayIso();

  const supabase = createClient();
  await supabase
    .from("tenancies")
    .update({ status: "ended", end_date: endDate, updated_at: new Date().toISOString() })
    .eq("id", id);

  revalidatePath(`/dashboard/tenancies/${id}`);
  revalidatePath("/dashboard/tenancies");
  redirect(`/dashboard/tenancies/${id}?ended=1`);
}

// ===========================================================================
// Delete a tenancy (its tenants cascade via the FK ON DELETE CASCADE).
// ===========================================================================
export async function deleteTenancy(formData: FormData) {
  await requireCapability("manage_tenancies", FORBIDDEN);
  const id = s(formData, "id");
  if (!id) return;

  const supabase = createClient();
  await supabase.from("tenancies").delete().eq("id", id);

  revalidatePath("/dashboard/tenancies");
  revalidatePath("/dashboard");
  redirect("/dashboard/tenancies?deleted=1");
}

// ===========================================================================
// Co-tenant roster management on the detail page.
// ===========================================================================
export async function addTenant(formData: FormData) {
  await requireCapability("manage_tenancies", FORBIDDEN);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) return;

  const name = s(formData, "name") || null;
  const email = s(formData, "email") || null;
  const phone = s(formData, "phone") || null;
  if (name == null && email == null && phone == null) {
    redirect(`/dashboard/tenancies/${tenancyId}?err=tenant`);
  }

  const supabase = createClient();
  const { data: existing } = await supabase
    .from("tenants")
    .select("id")
    .eq("tenancy_id", tenancyId);
  const count = (existing ?? []).length;
  if (count >= MAX_TENANTS_PER_TENANCY) {
    redirect(`/dashboard/tenancies/${tenancyId}?err=max`);
  }

  const phoneE164 = normalizePhoneE164(phone);
  const personId = await resolvePersonId(supabase, org.id, {
    name,
    email,
    phone,
    phone_e164: phoneE164,
  });

  await supabase.from("tenants").insert({
    organization_id: org.id,
    tenancy_id: tenancyId,
    name,
    email,
    phone,
    // Normalized match key for the inbound-STOP webhook (mirrors leads.phone_e164).
    phone_e164: phoneE164,
    is_primary: count === 0, // first tenant on the tenancy becomes primary
    person_id: personId,
  });

  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(`/dashboard/tenancies/${tenancyId}?tenant=added`);
}

export async function removeTenant(formData: FormData) {
  await requireCapability("manage_tenancies", FORBIDDEN);
  const tenancyId = s(formData, "tenancy_id");
  const id = s(formData, "tenant_id");
  if (!tenancyId || !id) return;

  const supabase = createClient();
  const { data } = await supabase
    .from("tenants")
    .select("id, is_primary")
    .eq("tenancy_id", tenancyId);
  const rows = (data ?? []) as Array<{ id: string; is_primary: boolean }>;

  await supabase.from("tenants").delete().eq("id", id);

  // If we removed the primary and others remain, promote one so the tenancy
  // always keeps exactly one primary (the Rotessa payer slot).
  const removed = rows.find((r) => r.id === id);
  if (removed?.is_primary) {
    const next = rows.find((r) => r.id !== id);
    if (next) {
      await supabase.from("tenants").update({ is_primary: true }).eq("id", next.id);
    }
  }

  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(`/dashboard/tenancies/${tenancyId}?tenant=removed`);
}

export async function makePrimaryTenant(formData: FormData) {
  await requireCapability("manage_tenancies", FORBIDDEN);
  const tenancyId = s(formData, "tenancy_id");
  const id = s(formData, "tenant_id");
  if (!tenancyId || !id) return;

  const supabase = createClient();
  // Clear the current primary first (the partial unique index allows only one),
  // then set the new one. RLS scopes both writes to the caller's org.
  await supabase
    .from("tenants")
    .update({ is_primary: false })
    .eq("tenancy_id", tenancyId)
    .eq("is_primary", true);
  await supabase
    .from("tenants")
    .update({ is_primary: true })
    .eq("id", id)
    .eq("tenancy_id", tenancyId);

  revalidatePath(`/dashboard/tenancies/${tenancyId}`);
  redirect(`/dashboard/tenancies/${tenancyId}?tenant=primary`);
}

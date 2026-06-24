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
  validateQuoteTimeline,
  statusOffersTenantUpdate,
} from "@/lib/work-orders";
import { validateDirectoryListingInput, minimizeForDirectory } from "@/lib/directory";
import { canUseIncidentIntake, canUseIncidentDispatch } from "@/lib/billing";
import {
  workOrderTitleFromReport,
  normalizeDeclineReason,
} from "@/lib/incident-reports";
import {
  generateDispatchToken,
  dispatchTokenExpiry,
  normalizeOperatorNote,
  validateScheduleConfirmation,
  formatDispatchDate,
  tradeJobUrl,
  ACTIVE_DISPATCH_STATUSES,
  dispatchBriefOk,
} from "@/lib/work-order-dispatch";
import { sendTradeDispatchInvite } from "@/lib/email";
import { sendOrgNotification, type NotifyOrg } from "@/lib/notifications-server";
import { firstWord } from "@/lib/notifications";
import { validateMediaUpload, extForType } from "@/lib/incident-media";
import {
  INCIDENT_MEDIA_BUCKET,
  createIncidentMediaDownloadUrls,
  removeIncidentMedia,
} from "@/lib/incident-media-server";
import {
  workOrderMediaStoragePath,
  MAX_PHOTOS_PER_WORK_ORDER,
} from "@/lib/work-order-media";
import { randomUUID } from "crypto";

// The public app origin for deep links in notifications (matches lib/email.ts).
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

// The branding fields the notification shell needs, narrowed from getCurrentOrg.
function notifyOrgOf(org: {
  id: string;
  name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
}): NotifyOrg {
  return {
    id: org.id,
    name: org.name,
    brand_color: org.brand_color,
    logo_url: org.logo_url,
    reply_to_email: org.reply_to_email,
  };
}

// Job title + property address + the tenancy's primary-tenant contact for a work
// order, used to fill dispatch transition notifications. The operator's RLS
// client scopes both reads to their org. Returns nulls when a piece is missing
// (a job with no tenancy still notifies the trade; the tenant legs just skip).
async function dispatchPartyContext(
  supabase: ReturnType<typeof createClient>,
  workOrderId: string,
): Promise<{
  jobTitle: string;
  propertyAddress: string | null;
  tenantEmail: string | null;
  tenantName: string | null;
}> {
  const { data: wo } = await supabase
    .from("work_orders")
    .select("title, tenancy_id, property:properties(address)")
    .eq("id", workOrderId)
    .maybeSingle();
  const w = (wo as unknown as {
    title: string;
    tenancy_id: string | null;
    property: { address: string } | null;
  } | null) ?? null;

  let tenantEmail: string | null = null;
  let tenantName: string | null = null;
  if (w?.tenancy_id) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("email, name")
      .eq("tenancy_id", w.tenancy_id)
      .eq("is_primary", true)
      .maybeSingle();
    const t = tenant as { email: string | null; name: string | null } | null;
    tenantEmail = t?.email ?? null;
    tenantName = t?.name ?? null;
  }

  return {
    jobTitle: w?.title ?? "your maintenance request",
    propertyAddress: w?.property?.address ?? null,
    tenantEmail,
    tenantName,
  };
}

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

// Confirm a building_key actually names a building the org has at least one unit
// in (RLS scopes the read), so a forged key can't attach a shared cost to a
// building the owner doesn't have. Blank passes (nothing to attach).
async function buildingKeyOk(
  supabase: ReturnType<typeof createClient>,
  buildingKey: string | null,
): Promise<boolean> {
  if (!buildingKey) return true;
  const { data } = await supabase
    .from("properties")
    .select("id")
    .eq("building_key", buildingKey)
    .limit(1);
  return !!(data && data.length > 0);
}

// Expense scope (migration 0057): exactly one of unit / building / none. We
// derive property_id vs building_key from the chosen scope (never read both), so
// the DB CHECK can't be violated, and clear tenancy_id when the cost isn't tied
// to a unit. Returns an error code for a building scope with no building chosen.
type ResolvedScope =
  | { ok: true; propertyId: string | null; buildingKey: string | null; tenancyId: string | null }
  | { ok: false; code: string };

function resolveScope(formData: FormData): ResolvedScope {
  const scope = s(formData, "scope") || "unit"; // default unit (back-compat)
  if (scope === "building") {
    const buildingKey = s(formData, "building_key");
    if (!buildingKey) return { ok: false, code: "scope_building" };
    return { ok: true, propertyId: null, buildingKey, tenancyId: null };
  }
  if (scope === "none") {
    return { ok: true, propertyId: null, buildingKey: null, tenancyId: null };
  }
  // unit (default): honor the property + tenancy selects, ignore any building_key.
  return {
    ok: true,
    propertyId: orNull(formData, "property_id"),
    buildingKey: null,
    tenancyId: orNull(formData, "tenancy_id"),
  };
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

  const scope = resolveScope(formData);
  if (!scope.ok) redirect(`${BASE}?wo=${scope.code}`);

  // Quote + expected window (Slice 4). Optional; validated together so a finish
  // before a start (or a negative quote) is caught before the insert.
  const qt = validateQuoteTimeline({
    quoteCents: parseAmountToCents(s(formData, "quote")),
    expectedStart: s(formData, "expected_start"),
    expectedFinish: s(formData, "expected_finish"),
  });
  if (!qt.ok) redirect(`${BASE}?wo=${qt.code}`);

  const supabase = createClient();
  const propertyId = scope.propertyId;
  const buildingKey = scope.buildingKey;
  const tenancyId = scope.tenancyId;
  const tradeContactId = orNull(formData, "trade_contact_id");

  if (
    !(await fkOk(supabase, "properties", propertyId)) ||
    !(await fkOk(supabase, "tenancies", tenancyId)) ||
    !(await fkOk(supabase, "trade_contacts", tradeContactId)) ||
    !(await buildingKeyOk(supabase, buildingKey))
  ) {
    redirect(`${BASE}?wo=notfound`);
  }

  // A trade attached at creation means the job is at least "assigned".
  const status = tradeContactId ? "assigned" : "open";

  await supabase.from("work_orders").insert({
    organization_id: org.id,
    property_id: propertyId,
    building_key: buildingKey,
    tenancy_id: tenancyId,
    trade_contact_id: tradeContactId,
    title: check.value.title,
    description: s(formData, "description") || null,
    category: check.value.category,
    priority: check.value.priority,
    status,
    cost_cents: check.value.costCents,
    quote_cents: qt.value.quoteCents,
    expected_start: qt.value.expectedStart,
    expected_finish: qt.value.expectedFinish,
    reported_on: parseDateOrNull(s(formData, "reported_on")) ?? undefined,
    scheduled_for: parseDateOrNull(s(formData, "scheduled_for")),
  });

  revalidatePath(BASE);
  redirect(`${BASE}?wo=created`);
}

// Attach an operator photo to a work order (S328 dispatch-brief completion). For
// a job that did NOT come from a tenant report, this is the only way to give the
// dispatched trade a picture of the problem. Photos only; bytes land in the
// shared private incident-media bucket under the org's work-orders/ path (the
// bucket's org-folder RLS covers it), and the row points at them. The operator
// has a session, so this is a direct server-side upload (no anon signed-URL
// dance) — bodySizeLimit is already 30mb, comfortably over the 10 MB photo cap.
export async function uploadWorkOrderPhoto(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?wo=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const workOrderId = s(formData, "work_order_id");
  if (!workOrderId) redirect(`${BASE}?wo=notfound`);

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`${BASE}?wo=photo_empty#wo-${workOrderId}`);
  }

  const check = validateMediaUpload({ type: file.type, size: file.size });
  if (!check.ok) redirect(`${BASE}?wo=photo_${check.reason}#wo-${workOrderId}`);
  // Operator attachments are photos; video is the tenant-intake concern.
  if (check.kind !== "image") redirect(`${BASE}?wo=photo_type#wo-${workOrderId}`);

  const supabase = createClient();
  // RLS scopes this read to the caller's org — a forged id resolves to nothing.
  const { data: wo } = await supabase
    .from("work_orders")
    .select("id")
    .eq("id", workOrderId)
    .maybeSingle();
  if (!wo) redirect(`${BASE}?wo=notfound`);

  const { count } = await supabase
    .from("work_order_media")
    .select("id", { count: "exact", head: true })
    .eq("work_order_id", workOrderId);
  if ((count ?? 0) >= MAX_PHOTOS_PER_WORK_ORDER) {
    redirect(`${BASE}?wo=photo_too_many#wo-${workOrderId}`);
  }

  const path = workOrderMediaStoragePath(org.id, workOrderId, randomUUID(), extForType(file.type));
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage
    .from(INCIDENT_MEDIA_BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (upErr) redirect(`${BASE}?wo=photo_failed#wo-${workOrderId}`);

  const { error: insErr } = await supabase.from("work_order_media").insert({
    organization_id: org.id,
    work_order_id: workOrderId,
    storage_path: path,
    mime_type: file.type,
    size_bytes: file.size,
    kind: "image",
  });
  if (insErr) {
    // Don't leak an orphaned object if the metadata insert fails.
    await removeIncidentMedia(supabase, [path]);
    redirect(`${BASE}?wo=photo_failed#wo-${workOrderId}`);
  }

  revalidatePath(BASE);
  redirect(`${BASE}?wo=photo_added#wo-${workOrderId}`);
}

// Remove an operator-attached work-order photo (bytes + row). RLS scopes the
// lookup/delete to the caller's org.
export async function deleteWorkOrderPhoto(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?wo=forbidden`);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const mediaId = s(formData, "media_id");
  if (!mediaId) redirect(`${BASE}?wo=notfound`);

  const supabase = createClient();
  const { data: media } = await supabase
    .from("work_order_media")
    .select("work_order_id, storage_path")
    .eq("id", mediaId)
    .maybeSingle();
  if (!media) redirect(`${BASE}?wo=notfound`);
  const m = media as { work_order_id: string; storage_path: string };

  await supabase.from("work_order_media").delete().eq("id", mediaId);
  await removeIncidentMedia(supabase, [m.storage_path]);

  revalidatePath(BASE);
  redirect(`${BASE}?wo=photo_removed#wo-${m.work_order_id}`);
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

  const scope = resolveScope(formData);
  if (!scope.ok) redirect(`${BASE}?wo=${scope.code}`);

  const qt = validateQuoteTimeline({
    quoteCents: parseAmountToCents(s(formData, "quote")),
    expectedStart: s(formData, "expected_start"),
    expectedFinish: s(formData, "expected_finish"),
  });
  if (!qt.ok) redirect(`${BASE}?wo=${qt.code}`);

  const supabase = createClient();
  const propertyId = scope.propertyId;
  const buildingKey = scope.buildingKey;
  const tenancyId = scope.tenancyId;
  const tradeContactId = orNull(formData, "trade_contact_id");

  if (
    !(await fkOk(supabase, "properties", propertyId)) ||
    !(await fkOk(supabase, "tenancies", tenancyId)) ||
    !(await fkOk(supabase, "trade_contacts", tradeContactId)) ||
    !(await buildingKeyOk(supabase, buildingKey))
  ) {
    redirect(`${BASE}?wo=notfound`);
  }

  // RLS scopes the update to the caller's org. status/completed_on are changed
  // only through setWorkOrderStatus (which validates the lifecycle). property_id
  // and building_key are set as an exactly-one-of pair from the chosen scope, so
  // switching a cost from unit to building (or back) never leaves both set.
  await supabase
    .from("work_orders")
    .update({
      property_id: propertyId,
      building_key: buildingKey,
      tenancy_id: tenancyId,
      trade_contact_id: tradeContactId,
      title: check.value.title,
      description: s(formData, "description") || null,
      category: check.value.category,
      priority: check.value.priority,
      cost_cents: check.value.costCents,
      quote_cents: qt.value.quoteCents,
      expected_start: qt.value.expectedStart,
      expected_finish: qt.value.expectedFinish,
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
    // Carry the work-order id so the message offer can pre-fill the tenant note
    // with this job's quote + expected window (Slice 4).
    redirect(`${BASE}?wo=status&notify=${tenancyId}&to=${check.value.status}&wo_id=${id}`);
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

// --- Tenant incident reports: operator triage (Option B Slice 3) ------------
//
// Slice 2 let an account-less tenant FILE an incident_report (lands OFF the
// work_orders queue). These two actions are the operator side: APPROVE promotes
// a report to a real work_orders row (atomically, via the approve_incident_report
// SQL fn — migration 0062 — so a double click can't create two work orders) and
// marks the report converted; DECLINE records a reason and closes it. Both reuse
// manage_work_orders (same job: managing the owner's maintenance work) and are
// gated on the incident_intake entitlement (Growth+) — the feature's enforcement
// point, mirroring generateTenantReportLink. We still never dispatch a trade or
// move money: an approved report becomes a normal work order the owner runs the
// same way as any other (Slice 5 is the future trade-dispatch leap).

// Confirm the org may use incident intake (Growth+); redirect to a locked banner
// otherwise. Returns the org so callers can keep using it.
async function requireIncidentIntake(suffix: string) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  if (!canUseIncidentIntake(org.plan)) {
    redirect(`${BASE}?report=locked${suffix}`);
  }
  return org;
}

export async function approveIncidentReport(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?report=forbidden#reports`);
  await requireIncidentIntake("#reports");

  const id = s(formData, "report_id");
  if (!id) redirect(`${BASE}#reports`);

  const supabase = createClient();
  // RLS scopes this to the caller's org; a forged/other-org id finds nothing.
  // We read category + description here so the work-order title is derived in the
  // tested TS helper (the SQL fn only guards/falls back).
  const { data: report } = await supabase
    .from("incident_reports")
    .select("id, category, description, status")
    .eq("id", id)
    .maybeSingle();
  if (!report) redirect(`${BASE}?report=notfound#reports`);
  const r = report as { category: string; description: string; status: string };

  const title = workOrderTitleFromReport(r.category, r.description);

  const { data, error } = await supabase.rpc("approve_incident_report", {
    p_report_id: id,
    p_title: title,
  });
  const result = data as { ok?: boolean; reason?: string; work_order_id?: string } | null;
  if (error || !result?.ok) {
    // not_open = someone already approved/declined it (race or stale page).
    redirect(`${BASE}?report=${result?.reason === "not_open" ? "notopen" : "failed"}#reports`);
  }

  revalidatePath(BASE);
  redirect(`${BASE}?report=approved#reports`);
}

export async function declineIncidentReport(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?report=forbidden#reports`);
  await requireIncidentIntake("#reports");

  const id = s(formData, "report_id");
  if (!id) redirect(`${BASE}#reports`);

  const reason = normalizeDeclineReason(s(formData, "decline_reason"));
  const now = new Date().toISOString();

  const supabase = createClient();
  // RLS scopes the update to the caller's org. The status guard makes the decline
  // a no-op (0 rows) if the report was already converted/declined — surfaced as a
  // "no longer open" notice rather than silently overwriting a converted report.
  const { data: updated } = await supabase
    .from("incident_reports")
    .update({
      status: "declined",
      decline_reason: reason,
      reviewed_at: now,
      updated_at: now,
    })
    .eq("id", id)
    .in("status", ["submitted", "under_review"])
    .select("id");

  revalidatePath(BASE);
  redirect(`${BASE}?report=${updated && updated.length > 0 ? "declined" : "notopen"}#reports`);
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

// --- In-app trade dispatch (Option B Slice 5 — the guardrail amendment) ------
//
// THE leap past the old "directory + handoff only" guardrail (Noam-authorized,
// S313): the operator DISPATCHES a work order to one of their own trades, the
// trade accepts/declines + quotes + proposes a date via /job/[token], and the
// operator approves the quote by confirming a date, then marks it complete. We
// STILL never move money — the quote is a recorded number, the owner pays the
// trade DIRECTLY. Gated on incident_dispatch (Premium+) on TOP of the
// manage_work_orders capability, so it lands DARK for every non-Premium org. The
// trade side is account-less (token RPCs in 0065); the operator side here is
// ordinary authenticated, RLS-scoped, guarded UPDATEs (the declineIncidentReport
// pattern) — no new SECURITY DEFINER surface beyond the four token RPCs.

// Premium-gate the dispatch surface; redirect to a locked banner otherwise.
async function requireIncidentDispatch(suffix: string) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  if (!canUseIncidentDispatch(org.plan)) {
    redirect(`${BASE}?disp=locked${suffix}`);
  }
  return org;
}

// Slice 0 Block C: a one-time per-org acknowledgment that the operator hires +
// pays the trade directly, vets them, and that Vacantless is not a party. Stamps
// the org so dispatchWorkOrderToTrade can proceed. Premium-gated like the rest of
// the dispatch surface; manage_work_orders required.
export async function acknowledgeDispatchTerms() {
  await requireCapability("manage_work_orders", `${BASE}?disp=forbidden`);
  const org = await requireIncidentDispatch("");

  const supabase = createClient();
  // The acting member's auth uid is recorded for the audit trail (best-effort).
  const { data: auth } = await supabase.auth.getUser();
  await supabase
    .from("organizations")
    .update({
      dispatch_terms_accepted_at: new Date().toISOString(),
      dispatch_terms_accepted_by: auth?.user?.id ?? null,
    })
    .eq("id", org.id);

  revalidatePath(BASE);
  redirect(`${BASE}?disp=terms_accepted`);
}

// Dispatch a work order to one of the org's own trade contacts. Creates a
// work_order_dispatches row (status 'offered') with a single-job magic-link
// token, snapshots who it went to, and emails the trade the /job link
// (best-effort). The partial-unique index (0065) is the hard backstop against a
// second active dispatch; we also check first for a clean error.
export async function dispatchWorkOrderToTrade(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?disp=forbidden`);
  const org = await requireIncidentDispatch("");

  // Slice 0 Block C: the org must have accepted the one-time dispatch terms
  // before any job goes out to a trade.
  if (!org.dispatch_terms_accepted_at) redirect(`${BASE}?disp=terms_required`);

  const workOrderId = s(formData, "work_order_id");
  const tradeContactId = s(formData, "trade_contact_id");
  if (!workOrderId || !tradeContactId) redirect(`${BASE}?disp=notfound`);

  const supabase = createClient();

  // RLS scopes both reads to the caller's org — a forged id resolves to nothing.
  const { data: wo } = await supabase
    .from("work_orders")
    .select("id, title, description, status, property_id, building_key, property:properties(address)")
    .eq("id", workOrderId)
    .maybeSingle();
  if (!wo) redirect(`${BASE}?disp=notfound`);
  const w = wo as unknown as {
    id: string;
    title: string;
    description: string | null;
    status: string;
    property_id: string | null;
    building_key: string | null;
    property: { address: string } | null;
  };

  // The brief gate: don't send a job to a trade with nothing to act on. A trade
  // accepts/quotes from the job page; a blank description makes that impossible
  // (S328 dogfood). The work order can exist bare for the owner's own tracking —
  // this is only the outbound-to-a-trade boundary.
  if (!dispatchBriefOk(w.description)) redirect(`${BASE}?disp=needs_brief`);

  const { data: trade } = await supabase
    .from("trade_contacts")
    .select("id, name, email")
    .eq("id", tradeContactId)
    .maybeSingle();
  if (!trade) redirect(`${BASE}?disp=notfound`);
  const tc = trade as { id: string; name: string; email: string | null };
  if (!tc.email || tc.email.trim() === "") redirect(`${BASE}?disp=no_email`);

  // Reject a second active dispatch up front (the index is the backstop).
  const { data: active } = await supabase
    .from("work_order_dispatches")
    .select("id")
    .eq("work_order_id", workOrderId)
    .in("dispatch_status", ACTIVE_DISPATCH_STATUSES as unknown as string[])
    .limit(1);
  if (active && active.length > 0) redirect(`${BASE}?disp=active_exists`);

  const token = generateDispatchToken();
  const { error: insErr } = await supabase.from("work_order_dispatches").insert({
    organization_id: org.id,
    work_order_id: workOrderId,
    trade_contact_id: tc.id,
    trade_name_snapshot: tc.name,
    trade_email_snapshot: tc.email,
    operator_note: normalizeOperatorNote(s(formData, "operator_note")),
    dispatch_status: "offered",
    trade_access_token: token,
    token_expires_at: dispatchTokenExpiry().toISOString(),
  });
  // A unique-violation here means a race lost to the partial-unique index.
  if (insErr) redirect(`${BASE}?disp=active_exists`);

  // Email the trade the job link (best-effort; never fails the dispatch).
  try {
    await sendTradeDispatchInvite({
      trade_email: tc.email,
      trade_name: tc.name,
      token,
      job_title: w.title,
      property_address: w.property?.address ?? w.building_key ?? null,
      org_name: org.name,
      brand_color: org.brand_color,
      logo_url: org.logo_url,
      reply_to_email: org.reply_to_email,
    });
  } catch {
    // swallow — the dispatch is recorded; the operator can re-send/copy the link
  }

  revalidatePath(BASE);
  redirect(`${BASE}?disp=dispatched`);
}

// Operator approves a submitted quote BY confirming the agreed date (quoted ->
// scheduled in one step). Guarded so a stale page can't approve a dispatch that
// already moved on.
export async function approveDispatchSchedule(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?disp=forbidden`);
  const org = await requireIncidentDispatch("");

  const id = s(formData, "dispatch_id");
  if (!id) redirect(BASE);

  const check = validateScheduleConfirmation({ scheduledFor: s(formData, "scheduled_for") });
  if (!check.ok) redirect(`${BASE}?disp=${check.code}`);

  const now = new Date().toISOString();
  const supabase = createClient();
  const { data: updated } = await supabase
    .from("work_order_dispatches")
    .update({
      dispatch_status: "scheduled",
      scheduled_for: check.value.scheduledFor,
      proposed_by: "operator",
      schedule_confirmed_at: now,
      updated_at: now,
    })
    .eq("id", id)
    .eq("dispatch_status", "quoted")
    .select("id, work_order_id, trade_email_snapshot, trade_name_snapshot, trade_access_token, scheduled_for");

  // Slice 6: tell the trade they're booked and the tenant the date (best-effort;
  // a mail failure never reverses the schedule). Both events are operator-
  // customizable (copy + cc recipients) via notification_settings.
  const d = updated && updated.length > 0 ? (updated[0] as {
    work_order_id: string;
    trade_email_snapshot: string | null;
    trade_name_snapshot: string | null;
    trade_access_token: string | null;
    scheduled_for: string | null;
  }) : null;
  if (d) {
    const ctx = await dispatchPartyContext(supabase, d.work_order_id);
    const notifyOrg = notifyOrgOf(org);
    const scheduledDate = formatDispatchDate(d.scheduled_for);
    const propertyAddress = ctx.propertyAddress ?? "the property";

    await sendOrgNotification({
      client: supabase,
      org: notifyOrg,
      eventKey: "dispatch.scheduled.trade",
      audienceEmail: d.trade_email_snapshot,
      vars: {
        org_name: org.name ?? "Your property manager",
        property_address: propertyAddress,
        trade_name: d.trade_name_snapshot ?? "there",
        job_title: ctx.jobTitle,
        scheduled_date: scheduledDate,
        job_url: d.trade_access_token ? tradeJobUrl(APP_URL, d.trade_access_token) : "",
      },
    });

    if (ctx.tenantEmail) {
      await sendOrgNotification({
        client: supabase,
        org: notifyOrg,
        eventKey: "dispatch.scheduled.tenant",
        audienceEmail: ctx.tenantEmail,
        vars: {
          org_name: org.name ?? "Your property manager",
          property_address: propertyAddress,
          tenant_first_name: firstWord(ctx.tenantName),
          job_title: ctx.jobTitle,
          scheduled_date: scheduledDate,
        },
      });
    }
  }

  revalidatePath(BASE);
  redirect(`${BASE}?disp=${d ? "approved" : "wrong_state"}`);
}

// Operator marks a scheduled dispatch complete.
export async function completeDispatch(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?disp=forbidden`);
  const org = await requireIncidentDispatch("");

  const id = s(formData, "dispatch_id");
  if (!id) redirect(BASE);

  const now = new Date().toISOString();
  const supabase = createClient();
  const { data: updated } = await supabase
    .from("work_order_dispatches")
    .update({ dispatch_status: "completed", completed_at: now, updated_at: now })
    .eq("id", id)
    .eq("dispatch_status", "scheduled")
    .select("id, work_order_id");

  // Slice 6: tell the tenant the work is done (best-effort, customizable).
  const d = updated && updated.length > 0 ? (updated[0] as { work_order_id: string }) : null;
  if (d) {
    const ctx = await dispatchPartyContext(supabase, d.work_order_id);
    if (ctx.tenantEmail) {
      await sendOrgNotification({
        client: supabase,
        org: notifyOrgOf(org),
        eventKey: "dispatch.completed.tenant",
        audienceEmail: ctx.tenantEmail,
        vars: {
          org_name: org.name ?? "Your property manager",
          property_address: ctx.propertyAddress ?? "the property",
          tenant_first_name: firstWord(ctx.tenantName),
          job_title: ctx.jobTitle,
        },
      });
    }
  }

  revalidatePath(BASE);
  redirect(`${BASE}?disp=${d ? "completed" : "wrong_state"}`);
}

// Operator pulls a dispatch back any time before it's terminal.
export async function cancelDispatch(formData: FormData) {
  await requireCapability("manage_work_orders", `${BASE}?disp=forbidden`);
  const org = await requireIncidentDispatch("");

  const id = s(formData, "dispatch_id");
  if (!id) redirect(BASE);

  const now = new Date().toISOString();
  const supabase = createClient();
  const { data: updated } = await supabase
    .from("work_order_dispatches")
    .update({ dispatch_status: "cancelled", updated_at: now })
    .eq("id", id)
    .in("dispatch_status", ACTIVE_DISPATCH_STATUSES as unknown as string[])
    .select("id, work_order_id, trade_email_snapshot, trade_name_snapshot");

  // Slice 6: tell the trade the job's been pulled (best-effort, customizable).
  const d = updated && updated.length > 0 ? (updated[0] as {
    work_order_id: string;
    trade_email_snapshot: string | null;
    trade_name_snapshot: string | null;
  }) : null;
  if (d) {
    const ctx = await dispatchPartyContext(supabase, d.work_order_id);
    await sendOrgNotification({
      client: supabase,
      org: notifyOrgOf(org),
      eventKey: "dispatch.cancelled.trade",
      audienceEmail: d.trade_email_snapshot,
      vars: {
        org_name: org.name ?? "Your property manager",
        property_address: ctx.propertyAddress ?? "the property",
        trade_name: d.trade_name_snapshot ?? "there",
        job_title: ctx.jobTitle,
      },
    });
  }

  revalidatePath(BASE);
  redirect(`${BASE}?disp=${d ? "cancelled" : "wrong_state"}`);
}

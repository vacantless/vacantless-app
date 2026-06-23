import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  BrandBanner,
  Card,
  StatCard,
  StatusChip,
  EmptyState,
  SectionHeading,
  PRIMARY_ACTION_CLASS,
  SECONDARY_ACTION_CLASS,
  type ChipTone,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { SubmitButton } from "@/components/submit-button";
import {
  WORK_ORDER_CATEGORIES,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
  workOrderStatusLabel,
  workOrderCategoryLabel,
  workOrderPriorityLabel,
  workOrderStatusTone,
  workOrderPriorityTone,
  nextStatuses,
  isActiveStatus,
  formatMoneyCents,
  formatExpectedWindow,
  workOrderErrorMessage,
} from "@/lib/work-orders";
import {
  publicListingView,
  rankListings,
  directoryErrorMessage,
  type DirectoryListing,
} from "@/lib/directory";
import { splitAddressUnit } from "@/lib/listing-fill-sheet";
import { getCurrentOrg } from "@/lib/org";
import { canUseIncidentIntake } from "@/lib/billing";
import {
  incidentCategoryLabel,
  incidentReportStatusLabel,
  workOrderTitleFromReport,
} from "@/lib/incident-reports";
import { createIncidentMediaDownloadUrls } from "@/lib/incident-media-server";
import {
  createWorkOrder,
  updateWorkOrder,
  setWorkOrderStatus,
  deleteWorkOrder,
  approveIncidentReport,
  declineIncidentReport,
  createTradeContact,
  updateTradeContact,
  archiveTradeContact,
  promoteTradeToDirectory,
  unlistDirectoryTrade,
  addDirectoryTradeToRolodex,
} from "./actions";

export const dynamic = "force-dynamic";

// ============================================================================
// Maintenance — work-order module Slice 2 (S305). The keystone surface of the
// self-managed-owner wedge: the owner logs a maintenance issue, assigns it to
// one of THEIR OWN trades, tracks it through a status lifecycle, and records
// the cost (which feeds the future financial-statement export). We never
// dispatch a trade or move money.
//
// Server component, native server-action forms — no client state. Filters are
// query params (server-side .eq). Status changes go through setWorkOrderStatus
// which validates the lifecycle (lib/work-orders).
// ============================================================================

type WorkOrderRow = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  cost_cents: number | null;
  quote_cents: number | null;
  expected_start: string | null;
  expected_finish: string | null;
  reported_on: string | null;
  scheduled_for: string | null;
  completed_on: string | null;
  property_id: string | null;
  building_key: string | null;
  tenancy_id: string | null;
  trade_contact_id: string | null;
  property: { address: string } | null;
  trade: { name: string; trade_type: string | null } | null;
};

type TradeRow = {
  id: string;
  name: string;
  trade_type: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  archived: boolean;
  directory_opt_in: boolean;
};

// A directory_trades row as read from the DB (before PII minimization). Carries
// the write-scoping fields the public view type omits.
type DirectoryRow = DirectoryListing & {
  listed: boolean;
  archived: boolean;
  contributed_by_org: string | null;
  source_trade_contact_id: string | null;
};

// An open tenant incident report awaiting triage (Option B Slice 3). Joined to
// the unit address + the tenancy's primary tenant for context.
type IncidentReportRow = {
  id: string;
  category: string;
  description: string;
  reporter_name: string | null;
  reporter_contact: string | null;
  status: string;
  submitted_at: string;
  property: { address: string } | null;
  tenancy: { id: string; tenants: { name: string | null; is_primary: boolean }[] } | null;
};

type IncidentMediaRow = {
  id: string;
  incident_report_id: string;
  storage_path: string;
  mime_type: string;
  kind: string;
};

type PropertyRef = { id: string; address: string; building_key: string | null };
type TenancyRef = { id: string; label: string };
type BuildingOption = { key: string; label: string };

// The expense-scope control (migration 0057): a cost is for one specific unit,
// the whole building (a shared cost), or nothing unit-specific.
const SCOPE_OPTIONS = [
  { value: "unit", label: "A specific unit" },
  { value: "building", label: "The whole building" },
  { value: "none", label: "Not unit-specific" },
] as const;

// Map the lib's tone vocabulary onto the shared StatusChip ChipTone set.
function chipTone(tone: string): ChipTone {
  switch (tone) {
    case "green":
      return "success";
    case "blue":
      return "info";
    case "amber":
      return "warn";
    case "red":
      return "danger";
    default:
      return "neutral";
  }
}

const WO_SUCCESS: Record<string, string> = {
  created: "Work order created.",
  saved: "Work order updated.",
  status: "Work order status updated.",
  deleted: "Work order deleted.",
};
const TRADE_SUCCESS: Record<string, string> = {
  created: "Trade contact added.",
  saved: "Trade contact updated.",
  archived: "Trade contact archived.",
  restored: "Trade contact restored.",
};
const DIR_SUCCESS: Record<string, string> = {
  listed: "Trade listed in the network. Other landlords nearby can now find them.",
  unlisted: "Trade removed from the network.",
  added: "Added to your trades. You contact and pay them directly.",
};
// Benign, non-error outcomes (informational, not a red banner).
const DIR_INFO: Record<string, string> = {
  already_added: "You already have this trade in your rolodex.",
  own: "That's your own listing - it's already in your trades.",
};
// Incident-report triage (Slice 3) outcomes.
const REPORT_SUCCESS: Record<string, string> = {
  approved: "Report approved and converted to a work order. Assign a trade and cost below.",
  declined: "Report declined.",
};
const REPORT_INFO: Record<string, string> = {
  notopen: "That report was already handled by you or a teammate.",
};
const REPORT_ERROR: Record<string, string> = {
  forbidden: "You don't have permission to triage tenant reports.",
  notfound: "That report could not be found.",
  locked: "Tenant issue reporting is a Growth feature. Upgrade to enable it.",
  failed: "Something went wrong handling that report. Please try again.",
};

function fmtDate(d: string | null): string {
  if (!d) return "—";
  // d is a plain "YYYY-MM-DD" date string; render without timezone drift.
  const [y, m, day] = d.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !day) return d;
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// A timestamptz (incident report submitted_at) -> short local datetime.
function fmtDateTime(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_FILTERS = ["all", "active", ...WORK_ORDER_STATUSES] as const;

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: {
    wo?: string;
    trade?: string;
    report?: string;
    status?: string;
    property?: string;
    priority?: string;
    edit?: string;
    notify?: string;
    to?: string;
    wo_id?: string;
    dir?: string;
    dirType?: string;
    dirArea?: string;
  };
}) {
  const supabase = createClient();

  const [
    { data: woData },
    { data: tradeData },
    { data: propData },
    { data: tenData },
    { data: dirData },
    { data: reportData },
    org,
  ] = await Promise.all([
    supabase
      .from("work_orders")
      .select(
        "id, title, description, category, priority, status, cost_cents, quote_cents, expected_start, expected_finish, reported_on, scheduled_for, completed_on, property_id, building_key, tenancy_id, trade_contact_id, property:properties(address), trade:trade_contacts(name, trade_type)",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("trade_contacts")
      .select("id, name, trade_type, phone, email, note, archived, directory_opt_in")
      .order("archived", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("properties")
      .select("id, address, building_key")
      .order("address", { ascending: true }),
    supabase
      .from("tenancies")
      .select("id, property:properties(address), tenants(name, is_primary)")
      .order("created_at", { ascending: false }),
    // The directory read policy (0055) returns LISTED, non-archived rows from
    // ANY org, plus this org's own contributed rows (even unlisted). We filter
    // to the browse set in memory below.
    supabase
      .from("directory_trades")
      .select(
        "id, source, business_name, trade_type, service_area, blurb, phone, email, contact_public, verified, used_count, listed, archived, contributed_by_org, source_trade_contact_id",
      )
      .order("used_count", { ascending: false }),
    // Open tenant incident reports awaiting triage (Slice 3). RLS scopes to the
    // org; oldest first so the operator works the backlog top-down.
    supabase
      .from("incident_reports")
      .select(
        "id, category, description, reporter_name, reporter_contact, status, submitted_at, property:properties(address), tenancy:tenancies(id, tenants(name, is_primary))",
      )
      .in("status", ["submitted", "under_review"])
      .order("submitted_at", { ascending: true }),
    getCurrentOrg(),
  ]);

  const allOrders = (woData ?? []) as unknown as WorkOrderRow[];
  const trades = (tradeData ?? []) as TradeRow[];
  const properties = (propData ?? []) as PropertyRef[];
  const activeTrades = trades.filter((t) => !t.archived);
  const orgId = org?.id ?? null;

  // --- Tenant incident reports: triage inbox (Option B Slice 3) --------------
  // Gated on the incident_intake entitlement (Growth+). When entitled we surface
  // the open queue + the tenant's attached photos/video (signed preview URLs,
  // minted with the operator's RLS client — the 0060 SELECT policy scopes them to
  // this org's folder). When not entitled we show a locked upsell instead.
  const canIntake = canUseIncidentIntake(org?.plan);
  const openReports = (reportData ?? []) as unknown as IncidentReportRow[];

  // Map report id -> its media (with a freshly-signed preview URL per object).
  const reportMedia = new Map<string, { url: string; kind: string }[]>();
  if (canIntake && openReports.length > 0) {
    const { data: mediaData } = await supabase
      .from("incident_media")
      .select("id, incident_report_id, storage_path, mime_type, kind")
      .in(
        "incident_report_id",
        openReports.map((r) => r.id),
      );
    const media = (mediaData ?? []) as IncidentMediaRow[];
    if (media.length > 0) {
      const signed = await createIncidentMediaDownloadUrls(
        supabase,
        media.map((m) => m.storage_path),
      );
      const urlByPath = new Map<string, string | null>();
      if (signed.ok) for (const u of signed.urls) urlByPath.set(u.path, u.signedUrl);
      for (const m of media) {
        const url = urlByPath.get(m.storage_path);
        if (!url) continue;
        const list = reportMedia.get(m.incident_report_id) ?? [];
        list.push({ url, kind: m.kind });
        reportMedia.set(m.incident_report_id, list);
      }
    }
  }

  function reportReporter(r: IncidentReportRow): string {
    if (r.reporter_name) return r.reporter_name;
    const primary =
      r.tenancy?.tenants?.find((t) => t.is_primary) ?? r.tenancy?.tenants?.[0];
    return primary?.name ?? "Tenant";
  }

  // Distinct buildings (for the "whole building" scope), each labeled by the
  // unit-stripped street address of a representative unit — not the raw key.
  const buildingLabels = new Map<string, string>();
  for (const p of properties) {
    if (!p.building_key) continue;
    if (!buildingLabels.has(p.building_key)) {
      buildingLabels.set(p.building_key, splitAddressUnit(p.address).street ?? p.address);
    }
  }
  const buildingOptions: BuildingOption[] = [...buildingLabels.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  // The scope line for a work-order row: a specific unit, a whole building, or
  // not unit-specific.
  function scopeLine(o: WorkOrderRow): { label: string; value: string } {
    if (o.property_id) return { label: "Unit", value: o.property?.address ?? "—" };
    if (o.building_key)
      return { label: "Building-wide", value: buildingLabels.get(o.building_key) ?? o.building_key };
    return { label: "Scope", value: "Not unit-specific" };
  }

  const tenancies: TenancyRef[] = (
    (tenData ?? []) as unknown as {
      id: string;
      property: { address: string } | null;
      tenants: { name: string | null; is_primary: boolean }[];
    }[]
  ).map((t) => {
    const primary = t.tenants?.find((x) => x.is_primary) ?? t.tenants?.[0];
    const who = primary?.name ?? "Tenant";
    return { id: t.id, label: `${t.property?.address ?? "Unit"} · ${who}` };
  });

  // --- Filters (applied in memory; the org's full set is already small) ------
  const fStatus = searchParams.status ?? "active";
  const fProperty = searchParams.property ?? "";
  const fPriority = searchParams.priority ?? "";

  const orders = allOrders.filter((o) => {
    if (fStatus === "active" && !isActiveStatus(o.status)) return false;
    if (fStatus !== "all" && fStatus !== "active" && o.status !== fStatus) return false;
    if (fProperty && o.property_id !== fProperty) return false;
    if (fPriority && o.priority !== fPriority) return false;
    return true;
  });

  // --- Stats (across all orders, not the filtered view) ----------------------
  const openCount = allOrders.filter((o) => isActiveStatus(o.status)).length;
  const urgentOpen = allOrders.filter(
    (o) => isActiveStatus(o.status) && o.priority === "urgent",
  ).length;
  const now = new Date();
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const monthSpend = allOrders.reduce(
    (sum, o) =>
      o.completed_on && o.completed_on >= monthStart && o.cost_cents
        ? sum + o.cost_cents
        : sum,
    0,
  );

  const woFlash = searchParams.wo ? WO_SUCCESS[searchParams.wo] : null;
  const tradeFlash = searchParams.trade ? TRADE_SUCCESS[searchParams.trade] : null;
  const reportFlash = searchParams.report
    ? (REPORT_SUCCESS[searchParams.report] ?? REPORT_INFO[searchParams.report] ?? null)
    : null;
  const reportError =
    searchParams.report && !REPORT_SUCCESS[searchParams.report] && !REPORT_INFO[searchParams.report]
      ? (REPORT_ERROR[searchParams.report] ?? "Something went wrong.")
      : null;
  const woError =
    searchParams.wo && !WO_SUCCESS[searchParams.wo]
      ? workOrderErrorMessage(searchParams.wo)
      : null;
  const tradeError =
    searchParams.trade && !TRADE_SUCCESS[searchParams.trade]
      ? workOrderErrorMessage(searchParams.trade)
      : null;

  const editId = searchParams.edit ?? "";

  // Comms tie-in (Slice 4): after a status change on a work order tied to a
  // tenancy, offer to message that tenant. The action sets ?notify=<tenancyId>
  // &to=<status>; we resolve the tenancy label here and deep-link to its message
  // composer with the matching maintenance template pre-loaded (#message anchor).
  const notifyTenancy =
    searchParams.notify && searchParams.to
      ? tenancies.find((t) => t.id === searchParams.notify)
      : null;
  const notifyStatusLabel =
    notifyTenancy && searchParams.to ? workOrderStatusLabel(searchParams.to) : null;

  // --- Trades directory (the local network) view model -----------------------
  // The browse set is the listed, non-archived rows; this org's own contributed
  // rows come back too (read_own policy) so we can label + manage them. Every
  // row is mapped through publicListingView, which strips phone/email unless the
  // viewer already added the trade (or it's their own / contact_public) — PII
  // minimization at the app layer, since RLS gates rows, not columns.
  const allListings = (dirData ?? []) as unknown as DirectoryRow[];
  const rolodexNames = new Set(
    trades.filter((t) => !t.archived).map((t) => t.name.trim().toLowerCase()),
  );
  const dirType = (searchParams.dirType ?? "").trim();
  const dirArea = (searchParams.dirArea ?? "").trim().toLowerCase();

  const browse = allListings.filter((l) => l.listed && !l.archived);
  const directoryTypes = Array.from(
    new Set(browse.map((l) => l.trade_type).filter((t): t is string => !!t)),
  ).sort((a, b) => a.localeCompare(b));

  const directoryCards = rankListings(
    browse.filter((l) => {
      if (dirType && (l.trade_type ?? "") !== dirType) return false;
      if (dirArea && !(l.service_area ?? "").toLowerCase().includes(dirArea)) return false;
      return true;
    }),
  ).map((l) => {
    const isOwn = !!orgId && l.contributed_by_org === orgId;
    const isAdded = rolodexNames.has(l.business_name.trim().toLowerCase());
    const view = publicListingView(l, isOwn || isAdded);
    return { ...view, isOwn, isAdded, source_trade_contact_id: l.source_trade_contact_id };
  });

  const dirFlash = searchParams.dir
    ? (DIR_SUCCESS[searchParams.dir] ?? DIR_INFO[searchParams.dir] ?? null)
    : null;
  const dirError =
    searchParams.dir && !DIR_SUCCESS[searchParams.dir] && !DIR_INFO[searchParams.dir]
      ? directoryErrorMessage(searchParams.dir)
      : null;

  // Network-filter href that preserves the work-order filters (separate section).
  const dirFilterHref = (patch: { dirType?: string; dirArea?: string }) => {
    const p = new URLSearchParams();
    if (fStatus && fStatus !== "active") p.set("status", fStatus);
    if (fProperty) p.set("property", fProperty);
    if (fPriority) p.set("priority", fPriority);
    const t = patch.dirType ?? dirType;
    const a = patch.dirArea ?? searchParams.dirArea ?? "";
    if (t) p.set("dirType", t);
    if (a) p.set("dirArea", a);
    const qs = p.toString();
    return qs ? `/dashboard/maintenance?${qs}#network` : "/dashboard/maintenance#network";
  };

  // Build a filter href preserving the other active filters.
  const filterHref = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    const merged = { status: fStatus, property: fProperty, priority: fPriority, ...patch };
    if (merged.status && merged.status !== "active") p.set("status", merged.status);
    if (merged.property) p.set("property", merged.property);
    if (merged.priority) p.set("priority", merged.priority);
    const qs = p.toString();
    return qs ? `/dashboard/maintenance?${qs}` : "/dashboard/maintenance";
  };

  const inputCls =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
  const labelCls = "block text-xs font-medium text-gray-600";

  return (
    <div>
      <BrandBanner
        eyebrow="Maintenance"
        title="Work orders"
        subtitle="Log a maintenance issue, assign it to one of your own trades, and track it to done. Costs you record here feed your year-end statements. Vacantless tracks the work; it never dispatches a trade or moves money."
        icon={<Icons.bolt className="h-6 w-6" />}
        action={
          <>
            <Link href="/dashboard/maintenance/notices" className={SECONDARY_ACTION_CLASS}>
              Building notices
            </Link>
            <a href="#new-work-order" className={PRIMARY_ACTION_CLASS} style={{ background: "var(--brand-gradient, var(--brand-color))" }}>
              New work order
            </a>
          </>
        }
      />

      {(woFlash || tradeFlash || dirFlash || reportFlash) && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {woFlash ?? tradeFlash ?? dirFlash ?? reportFlash}
        </div>
      )}
      {(woError || tradeError || dirError || reportError) && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {woError ?? tradeError ?? dirError ?? reportError}
        </div>
      )}

      {notifyTenancy && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 text-sm text-gray-700">
          <span>
            Status changed to{" "}
            <span className="font-medium text-gray-900">{notifyStatusLabel}</span>. Want to
            let the tenant know? We&rsquo;ll open a message with the matching template ready
            to review.
          </span>
          <Link
            href={`/dashboard/tenancies/${notifyTenancy.id}?wo_msg=${searchParams.to}${
              searchParams.wo_id ? `&wo_id=${searchParams.wo_id}` : ""
            }#message`}
            className={`${SECONDARY_ACTION_CLASS} shrink-0`}
          >
            Message the tenant →
          </Link>
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Open work orders" value={openCount} hint="Not yet completed or cancelled" icon={<Icons.bolt className="h-4 w-4" />} />
        <StatCard label="Urgent & open" value={urgentOpen} hint="Marked urgent, still active" icon={<Icons.clock className="h-4 w-4" />} />
        <StatCard label="Spent this month" value={formatMoneyCents(monthSpend)} hint="Completed work, current month" icon={<Icons.card className="h-4 w-4" />} />
      </div>

      <div className="mt-3 text-sm text-gray-600">
        The costs you record here roll into your{" "}
        <Link href="/dashboard/rent/statement" className="font-medium text-brand hover:underline">
          owner statement
        </Link>{" "}
        — rent in minus maintenance out, per property, for year-end.
      </div>

      {/* Tenant-reported issues — triage inbox (Option B Slice 3) */}
      <div id="reports" className="mt-8 scroll-mt-6">
        <SectionHeading>
          Tenant-reported issues
          {canIntake && openReports.length > 0 ? ` (${openReports.length})` : ""}
        </SectionHeading>

        {!canIntake ? (
          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900">Let tenants report issues themselves</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Give each tenancy a private link to report a maintenance problem with photos or a
                  short video. Reports land here for you to approve into a work order — no tenant
                  account needed. Available on Growth and up.
                </p>
              </div>
              <Link
                href="/dashboard/billing"
                className={`${PRIMARY_ACTION_CLASS} shrink-0`}
                style={{ background: "var(--brand-gradient, var(--brand-color))" }}
              >
                Upgrade
              </Link>
            </div>
          </Card>
        ) : openReports.length === 0 ? (
          <EmptyState
            icon={<Icons.bolt className="h-5 w-5" />}
            title="No tenant reports waiting"
            description="When a tenant submits an issue through their reporting link, it shows up here to approve into a work order or decline. Share a tenancy's link from its page under Tenants."
          />
        ) : (
          <div className="space-y-3">
            {openReports.map((r) => {
              const media = reportMedia.get(r.id) ?? [];
              const previewTitle = workOrderTitleFromReport(r.category, r.description);
              return (
                <Card key={r.id}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusChip tone="warn">{incidentReportStatusLabel(r.status)}</StatusChip>
                        <StatusChip tone="neutral">{incidentCategoryLabel(r.category)}</StatusChip>
                        <span className="text-xs text-gray-500">{fmtDateTime(r.submitted_at)}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-700">
                        {r.description}
                      </p>
                      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
                        <div>
                          <dt className="inline font-medium text-gray-600">From: </dt>
                          <dd className="inline">{reportReporter(r)}</dd>
                        </div>
                        {r.reporter_contact && (
                          <div>
                            <dt className="inline font-medium text-gray-600">Contact: </dt>
                            <dd className="inline">{r.reporter_contact}</dd>
                          </div>
                        )}
                        <div>
                          <dt className="inline font-medium text-gray-600">Unit: </dt>
                          <dd className="inline">{r.property?.address ?? "—"}</dd>
                        </div>
                      </dl>

                      {/* Tenant-attached media (signed preview URLs). */}
                      {media.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {media.map((m, i) =>
                            m.kind === "video" ? (
                              <video
                                key={i}
                                src={m.url}
                                controls
                                className="h-24 w-32 rounded-lg border border-gray-200 bg-black object-cover"
                              />
                            ) : (
                              <a key={i} href={m.url} target="_blank" rel="noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={m.url}
                                  alt="Tenant-attached photo"
                                  className="h-24 w-24 rounded-lg border border-gray-200 object-cover transition hover:opacity-90"
                                />
                              </a>
                            ),
                          )}
                        </div>
                      )}
                    </div>

                    {/* Triage actions */}
                    <div className="flex shrink-0 flex-col items-stretch gap-2 sm:w-56">
                      <form action={approveIncidentReport}>
                        <input type="hidden" name="report_id" value={r.id} />
                        <SubmitButton
                          className={`${PRIMARY_ACTION_CLASS} w-full justify-center`}
                          style={{ background: "var(--brand-gradient, var(--brand-color))" }}
                          pendingLabel="Approving…"
                        >
                          Approve → work order
                        </SubmitButton>
                      </form>
                      <p className="text-xs text-gray-500">
                        Creates: <span className="font-medium text-gray-600">{previewTitle}</span>
                      </p>
                      <details className="rounded-lg bg-gray-50 p-2">
                        <summary className="cursor-pointer text-xs font-medium text-gray-600">
                          Decline instead
                        </summary>
                        <form action={declineIncidentReport} className="mt-2 flex flex-col gap-1.5">
                          <input type="hidden" name="report_id" value={r.id} />
                          <textarea
                            name="decline_reason"
                            rows={2}
                            placeholder="Reason (optional, kept for your records)"
                            className={inputCls}
                          />
                          <SubmitButton
                            className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50"
                            pendingLabel="Declining…"
                          >
                            Decline report
                          </SubmitButton>
                        </form>
                      </details>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((sKey) => {
            const active = fStatus === sKey;
            const label =
              sKey === "all" ? "All" : sKey === "active" ? "Active" : workOrderStatusLabel(sKey);
            return (
              <Link
                key={sKey}
                href={filterHref({ status: sKey })}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
                  active
                    ? "bg-brand text-white ring-transparent"
                    : "bg-white text-gray-600 ring-gray-200 hover:bg-gray-50"
                }`}
                style={active ? { background: "var(--brand-color)" } : undefined}
              >
                {label}
              </Link>
            );
          })}
        </div>
        {(fProperty || fPriority) && (
          <Link href={filterHref({ property: "", priority: "" })} className="text-xs font-medium text-brand hover:underline">
            Clear filters
          </Link>
        )}
      </div>

      {/* Work-order list */}
      <div className="mt-4 space-y-3">
        {orders.length === 0 ? (
          <EmptyState
            icon={<Icons.bolt className="h-5 w-5" />}
            title="No work orders here"
            description={
              allOrders.length === 0
                ? "When a tenant reports an issue or you schedule maintenance, log it here so nothing slips."
                : "No work orders match these filters. Try Active or All above."
            }
          />
        ) : (
          orders.map((o) => {
            const transitions = nextStatuses(o.status);
            const isEditing = editId === o.id;
            return (
              <Card key={o.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{o.title}</h3>
                      <StatusChip tone={chipTone(workOrderStatusTone(o.status))}>
                        {workOrderStatusLabel(o.status)}
                      </StatusChip>
                      <StatusChip tone={chipTone(workOrderPriorityTone(o.priority))}>
                        {workOrderPriorityLabel(o.priority)}
                      </StatusChip>
                      <StatusChip tone="neutral">{workOrderCategoryLabel(o.category)}</StatusChip>
                    </div>
                    {o.description && (
                      <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{o.description}</p>
                    )}
                    <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
                      <div>
                        <dt className="inline font-medium text-gray-600">{scopeLine(o).label}: </dt>
                        <dd className="inline">{scopeLine(o).value}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-gray-600">Trade: </dt>
                        <dd className="inline">
                          {o.trade
                            ? `${o.trade.name}${o.trade.trade_type ? ` (${o.trade.trade_type})` : ""}`
                            : "Unassigned"}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium text-gray-600">Reported: </dt>
                        <dd className="inline">{fmtDate(o.reported_on)}</dd>
                      </div>
                      {o.scheduled_for && (
                        <div>
                          <dt className="inline font-medium text-gray-600">Scheduled: </dt>
                          <dd className="inline">{fmtDate(o.scheduled_for)}</dd>
                        </div>
                      )}
                      {o.completed_on && (
                        <div>
                          <dt className="inline font-medium text-gray-600">Completed: </dt>
                          <dd className="inline">{fmtDate(o.completed_on)}</dd>
                        </div>
                      )}
                      <div>
                        <dt className="inline font-medium text-gray-600">Cost: </dt>
                        <dd className="inline">{o.cost_cents != null ? formatMoneyCents(o.cost_cents) : "—"}</dd>
                      </div>
                      {o.quote_cents != null && (
                        <div>
                          <dt className="inline font-medium text-gray-600">Quote: </dt>
                          <dd className="inline">{formatMoneyCents(o.quote_cents)}</dd>
                        </div>
                      )}
                      {formatExpectedWindow(o.expected_start, o.expected_finish) && (
                        <div>
                          <dt className="inline font-medium text-gray-600">Expected: </dt>
                          <dd className="inline">
                            {formatExpectedWindow(o.expected_start, o.expected_finish)}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>

                  {/* Status change + actions */}
                  <div className="flex shrink-0 flex-col items-stretch gap-2 sm:w-56">
                    {transitions.length > 0 && (
                      <form action={setWorkOrderStatus} className="flex flex-col gap-1.5 rounded-lg bg-gray-50 p-2">
                        <input type="hidden" name="id" value={o.id} />
                        <label className={labelCls} htmlFor={`status-${o.id}`}>
                          Move to
                        </label>
                        <select id={`status-${o.id}`} name="status" className={inputCls} defaultValue="">
                          <option value="" disabled>
                            Choose status…
                          </option>
                          {transitions.map((t) => (
                            <option key={t} value={t}>
                              {workOrderStatusLabel(t)}
                            </option>
                          ))}
                        </select>
                        <input
                          type="date"
                          name="completed_on"
                          className={inputCls}
                          aria-label="Completion date (used only when marking completed)"
                        />
                        <SubmitButton
                          className={`${SECONDARY_ACTION_CLASS} justify-center`}
                          pendingLabel="Updating…"
                        >
                          Update status
                        </SubmitButton>
                      </form>
                    )}
                    <div className="flex gap-2">
                      <Link
                        href={isEditing ? "/dashboard/maintenance" : `/dashboard/maintenance?edit=${o.id}`}
                        className={`${SECONDARY_ACTION_CLASS} flex-1 justify-center`}
                      >
                        {isEditing ? "Close" : "Edit"}
                      </Link>
                      <form action={deleteWorkOrder}>
                        <input type="hidden" name="id" value={o.id} />
                        <SubmitButton
                          className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50"
                          pendingLabel="…"
                        >
                          Delete
                        </SubmitButton>
                      </form>
                    </div>
                  </div>
                </div>

                {/* Inline edit form */}
                {isEditing && (
                  <form action={updateWorkOrder} className="mt-4 grid gap-3 border-t border-gray-100 pt-4 sm:grid-cols-2">
                    <input type="hidden" name="id" value={o.id} />
                    <div className="sm:col-span-2">
                      <label className={labelCls}>Title</label>
                      <input name="title" defaultValue={o.title} required className={inputCls} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelCls}>Description</label>
                      <textarea name="description" defaultValue={o.description ?? ""} rows={2} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Category</label>
                      <select name="category" defaultValue={o.category} className={inputCls}>
                        {WORK_ORDER_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {workOrderCategoryLabel(c)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Priority</label>
                      <select name="priority" defaultValue={o.priority} className={inputCls}>
                        {WORK_ORDER_PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {workOrderPriorityLabel(p)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelCls}>This expense is for</label>
                      <select
                        name="scope"
                        defaultValue={o.property_id ? "unit" : o.building_key ? "building" : "none"}
                        className={inputCls}
                      >
                        {SCOPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-gray-500">
                        Shared building costs (gardening, snow, roof) roll up at the building level, not onto one unit.
                      </p>
                    </div>
                    <div>
                      <label className={labelCls}>Unit (for a unit cost)</label>
                      <select name="property_id" defaultValue={o.property_id ?? ""} className={inputCls}>
                        <option value="">—</option>
                        {properties.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.address}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Building (for a shared cost)</label>
                      <select name="building_key" defaultValue={o.building_key ?? ""} className={inputCls}>
                        <option value="">—</option>
                        {buildingOptions.map((b) => (
                          <option key={b.key} value={b.key}>
                            {b.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Tenancy (optional)</label>
                      <select name="tenancy_id" defaultValue={o.tenancy_id ?? ""} className={inputCls}>
                        <option value="">—</option>
                        {tenancies.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Trade (optional)</label>
                      <select name="trade_contact_id" defaultValue={o.trade_contact_id ?? ""} className={inputCls}>
                        <option value="">Unassigned</option>
                        {activeTrades.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                            {t.trade_type ? ` (${t.trade_type})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Final cost (optional)</label>
                      <input name="cost" defaultValue={o.cost_cents != null ? (o.cost_cents / 100).toFixed(2) : ""} inputMode="decimal" placeholder="0.00" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Scheduled for (optional)</label>
                      <input type="date" name="scheduled_for" defaultValue={o.scheduled_for ?? ""} className={inputCls} />
                    </div>
                    <div className="sm:col-span-2 border-t border-gray-100 pt-3">
                      <p className="text-xs font-medium text-gray-600">Quote &amp; timeline for the tenant</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        An estimate and expected dates you can share with the tenant in a message. The
                        owner still pays the trade directly — Vacantless never moves money.
                      </p>
                    </div>
                    <div>
                      <label className={labelCls}>Quote / estimate (optional)</label>
                      <input name="quote" defaultValue={o.quote_cents != null ? (o.quote_cents / 100).toFixed(2) : ""} inputMode="decimal" placeholder="0.00" className={inputCls} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={labelCls}>Expected start</label>
                        <input type="date" name="expected_start" defaultValue={o.expected_start ?? ""} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Expected finish</label>
                        <input type="date" name="expected_finish" defaultValue={o.expected_finish ?? ""} className={inputCls} />
                      </div>
                    </div>
                    <div className="flex items-end gap-2 sm:col-span-2">
                      <SubmitButton
                        className={`${PRIMARY_ACTION_CLASS}`}
                        style={{ background: "var(--brand-gradient, var(--brand-color))" }}
                        pendingLabel="Saving…"
                      >
                        Save changes
                      </SubmitButton>
                      <Link href="/dashboard/maintenance" className={SECONDARY_ACTION_CLASS}>
                        Cancel
                      </Link>
                    </div>
                  </form>
                )}
              </Card>
            );
          })
        )}
      </div>

      {/* New work order */}
      <div id="new-work-order" className="mt-8 scroll-mt-6">
        <SectionHeading>New work order</SectionHeading>
        <Card>
          <form action={createWorkOrder} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>Title</label>
              <input name="title" required placeholder="e.g. Kitchen faucet leaking" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Description (optional)</label>
              <textarea name="description" rows={2} placeholder="What needs doing, access notes, etc." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Category</label>
              <select name="category" defaultValue="general" className={inputCls}>
                {WORK_ORDER_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {workOrderCategoryLabel(c)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Priority</label>
              <select name="priority" defaultValue="normal" className={inputCls}>
                {WORK_ORDER_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {workOrderPriorityLabel(p)}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>This expense is for</label>
              <select name="scope" defaultValue="unit" className={inputCls}>
                {SCOPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Pick a unit below for a unit cost, or a building for a shared cost (gardening, snow,
                roof). Shared costs roll up at the building level, not onto one unit.
              </p>
            </div>
            <div>
              <label className={labelCls}>Unit (for a unit cost)</label>
              <select name="property_id" defaultValue="" className={inputCls}>
                <option value="">—</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.address}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Building (for a shared cost)</label>
              <select name="building_key" defaultValue="" className={inputCls}>
                <option value="">—</option>
                {buildingOptions.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Tenancy (optional)</label>
              <select name="tenancy_id" defaultValue="" className={inputCls}>
                <option value="">—</option>
                {tenancies.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Assign trade (optional)</label>
              <select name="trade_contact_id" defaultValue="" className={inputCls}>
                <option value="">Unassigned</option>
                {activeTrades.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.trade_type ? ` (${t.trade_type})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Final cost (optional)</label>
              <input name="cost" inputMode="decimal" placeholder="0.00" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Reported on</label>
              <input type="date" name="reported_on" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Scheduled for (optional)</label>
              <input type="date" name="scheduled_for" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Quote / estimate (optional)</label>
              <input name="quote" inputMode="decimal" placeholder="0.00" className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:col-span-2">
              <div>
                <label className={labelCls}>Expected start (optional)</label>
                <input type="date" name="expected_start" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Expected finish (optional)</label>
                <input type="date" name="expected_finish" className={inputCls} />
              </div>
            </div>
            <div className="sm:col-span-2">
              <SubmitButton
                className={PRIMARY_ACTION_CLASS}
                style={{ background: "var(--brand-gradient, var(--brand-color))" }}
                pendingLabel="Creating…"
              >
                Create work order
              </SubmitButton>
            </div>
          </form>
        </Card>
      </div>

      {/* Trade contacts rolodex */}
      <div id="trades" className="mt-8 scroll-mt-6">
        <SectionHeading>Your trades</SectionHeading>
        <p className="mb-3 text-sm text-gray-600">
          Your own roster of vendors. Add the people you already use; assign them to work orders. You pay your trades directly. Vacantless keeps the list and the history.
        </p>

        {activeTrades.length === 0 && trades.length === 0 ? null : (
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            {trades.map((t) => {
              return (
                <Card key={t.id} className={t.archived ? "opacity-60" : ""}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-gray-900">{t.name}</h3>
                        {t.trade_type && <StatusChip tone="info">{t.trade_type}</StatusChip>}
                        {t.archived && <StatusChip tone="neutral">Archived</StatusChip>}
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {[t.phone, t.email].filter(Boolean).join(" · ") || "No contact details"}
                      </p>
                      {t.note && <p className="mt-1 text-xs text-gray-500">{t.note}</p>}
                    </div>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-brand">Edit</summary>
                    <form action={updateTradeContact} className="mt-2 grid gap-2">
                      <input type="hidden" name="id" value={t.id} />
                      <input name="name" defaultValue={t.name} required placeholder="Name" className={inputCls} />
                      <input name="trade_type" defaultValue={t.trade_type ?? ""} placeholder="Trade (e.g. Plumber)" className={inputCls} />
                      <input name="phone" defaultValue={t.phone ?? ""} placeholder="Phone" className={inputCls} />
                      <input name="email" defaultValue={t.email ?? ""} placeholder="Email" className={inputCls} />
                      <input name="note" defaultValue={t.note ?? ""} placeholder="Note" className={inputCls} />
                      <div className="flex items-center gap-2">
                        <SubmitButton className={`${SECONDARY_ACTION_CLASS} justify-center`} pendingLabel="Saving…">
                          Save
                        </SubmitButton>
                      </div>
                    </form>
                    <form action={archiveTradeContact} className="mt-2">
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="archived" value={t.archived ? "0" : "1"} />
                      <SubmitButton className="text-xs font-medium text-gray-500 hover:text-gray-700" pendingLabel="…">
                        {t.archived ? "Restore" : "Archive"}
                      </SubmitButton>
                    </form>
                  </details>

                  {/* Directory opt-in (Slice 2): list this private trade in the
                      local network. Only the minimized fields go cross-org; the
                      note stays private. Consent is revocable. */}
                  {!t.archived && (
                    <div className="mt-2 border-t border-gray-100 pt-2">
                      {t.directory_opt_in ? (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                            <Icons.check className="h-3.5 w-3.5" /> Listed in the network
                          </span>
                          <form action={unlistDirectoryTrade}>
                            <input type="hidden" name="trade_contact_id" value={t.id} />
                            <SubmitButton className="text-xs font-medium text-gray-500 hover:text-gray-700" pendingLabel="…">
                              Remove from network
                            </SubmitButton>
                          </form>
                        </div>
                      ) : (
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-brand">
                            List in the trade network
                          </summary>
                          <form action={promoteTradeToDirectory} className="mt-2 grid gap-2">
                            <input type="hidden" name="trade_contact_id" value={t.id} />
                            <p className="text-xs text-gray-500">
                              Shows this trade&rsquo;s name, type, and service area to other
                              Vacantless landlords near you. Your private note is never shared.
                              Contact details stay hidden until someone adds them, unless you
                              tick the box below.
                            </p>
                            <input
                              name="service_area"
                              required
                              placeholder="Service area (e.g. Windsor, ON)"
                              className={inputCls}
                            />
                            <input
                              name="blurb"
                              placeholder="Short blurb (optional, e.g. Fast, reliable, fair rates)"
                              className={inputCls}
                            />
                            <label className="flex items-center gap-2 text-xs text-gray-600">
                              <input type="checkbox" name="contact_public" value="1" />
                              Show their phone and email to anyone browsing (otherwise revealed
                              only when a landlord adds them)
                            </label>
                            <SubmitButton className={`${SECONDARY_ACTION_CLASS} justify-center`} pendingLabel="Listing…">
                              List this trade
                            </SubmitButton>
                          </form>
                        </details>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        <Card>
          <form action={createTradeContact} className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Name</label>
              <input name="name" required placeholder="e.g. Dave's Plumbing" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Trade (optional)</label>
              <input name="trade_type" placeholder="Plumber, Roofer, HVAC…" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Phone (optional)</label>
              <input name="phone" placeholder="(519) 555-0123" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Email (optional)</label>
              <input name="email" type="email" placeholder="name@example.com" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Note (optional)</label>
              <input name="note" placeholder="Rates, hours, who to ask for…" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <SubmitButton className={SECONDARY_ACTION_CLASS} pendingLabel="Adding…">
                Add trade contact
              </SubmitButton>
            </div>
          </form>
        </Card>
      </div>

      {/* Trade network — the local directory (Slice 2) */}
      <div id="network" className="mt-8 scroll-mt-6">
        <SectionHeading>Find a trade</SectionHeading>
        <p className="mb-3 text-sm text-gray-600">
          Trades other Vacantless landlords near you already use. Add one to your trades
          and you contact, schedule, and pay them directly. Vacantless never dispatches a
          trade or handles the money. Listings show where each one came from; we only label
          a trade &ldquo;verified&rdquo; when we have actually vetted them.
        </p>

        {/* Filters */}
        {browse.length > 0 && (
          <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
            {fStatus && fStatus !== "active" && <input type="hidden" name="status" value={fStatus} />}
            {fProperty && <input type="hidden" name="property" value={fProperty} />}
            {fPriority && <input type="hidden" name="priority" value={fPriority} />}
            <div>
              <label className={labelCls}>Trade type</label>
              <select name="dirType" defaultValue={dirType} className={inputCls}>
                <option value="">All types</option>
                {directoryTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Service area</label>
              <input
                name="dirArea"
                defaultValue={searchParams.dirArea ?? ""}
                placeholder="e.g. Windsor"
                className={inputCls}
              />
            </div>
            <SubmitButton className={`${SECONDARY_ACTION_CLASS} justify-center`} pendingLabel="…">
              Filter
            </SubmitButton>
            {(dirType || dirArea) && (
              <Link href="/dashboard/maintenance#network" className="text-xs font-medium text-brand hover:underline">
                Clear
              </Link>
            )}
          </form>
        )}

        {directoryCards.length === 0 ? (
          <EmptyState
            icon={<Icons.users className="h-5 w-5" />}
            title={browse.length === 0 ? "No trades listed yet" : "No trades match these filters"}
            description={
              browse.length === 0
                ? "As landlords list their trusted trades, they'll show up here. List one of your own from “Your trades” above to seed your local network."
                : "Try a different trade type or area, or clear the filters."
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {directoryCards.map((l) => (
              <Card key={l.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{l.business_name}</h3>
                      {l.trade_type && <StatusChip tone="info">{l.trade_type}</StatusChip>}
                      {l.verified && <StatusChip tone="success">Vacantless-verified</StatusChip>}
                      {l.isOwn && <StatusChip tone="neutral">Your listing</StatusChip>}
                    </div>
                    <p className="mt-1 text-xs font-medium text-gray-500">{l.provenance}</p>
                    {l.service_area && (
                      <p className="mt-0.5 text-xs text-gray-500">{l.service_area}</p>
                    )}
                    {l.blurb && <p className="mt-1 text-sm text-gray-600">{l.blurb}</p>}
                    <p className="mt-1 text-xs text-gray-500">
                      {l.phone || l.email
                        ? [l.phone, l.email].filter(Boolean).join(" · ")
                        : "Contact shared once you add them"}
                    </p>
                  </div>
                </div>
                <div className="mt-3">
                  {l.isOwn ? (
                    l.source_trade_contact_id ? (
                      <form action={unlistDirectoryTrade}>
                        <input type="hidden" name="trade_contact_id" value={l.source_trade_contact_id} />
                        <SubmitButton className="text-xs font-medium text-gray-500 hover:text-gray-700" pendingLabel="…">
                          Remove from network
                        </SubmitButton>
                      </form>
                    ) : null
                  ) : l.isAdded ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <Icons.check className="h-3.5 w-3.5" /> In your trades
                    </span>
                  ) : (
                    <form action={addDirectoryTradeToRolodex}>
                      <input type="hidden" name="directory_trade_id" value={l.id} />
                      <SubmitButton className={`${SECONDARY_ACTION_CLASS} justify-center`} pendingLabel="Adding…">
                        Add to my trades
                      </SubmitButton>
                    </form>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

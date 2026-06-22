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
  workOrderErrorMessage,
} from "@/lib/work-orders";
import {
  createWorkOrder,
  updateWorkOrder,
  setWorkOrderStatus,
  deleteWorkOrder,
  createTradeContact,
  updateTradeContact,
  archiveTradeContact,
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
  reported_on: string | null;
  scheduled_for: string | null;
  completed_on: string | null;
  property_id: string | null;
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
};

type PropertyRef = { id: string; address: string };
type TenancyRef = { id: string; label: string };

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

const STATUS_FILTERS = ["all", "active", ...WORK_ORDER_STATUSES] as const;

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: {
    wo?: string;
    trade?: string;
    status?: string;
    property?: string;
    priority?: string;
    edit?: string;
  };
}) {
  const supabase = createClient();

  const [{ data: woData }, { data: tradeData }, { data: propData }, { data: tenData }] =
    await Promise.all([
      supabase
        .from("work_orders")
        .select(
          "id, title, description, category, priority, status, cost_cents, reported_on, scheduled_for, completed_on, property_id, tenancy_id, trade_contact_id, property:properties(address), trade:trade_contacts(name, trade_type)",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("trade_contacts")
        .select("id, name, trade_type, phone, email, note, archived")
        .order("archived", { ascending: true })
        .order("name", { ascending: true }),
      supabase.from("properties").select("id, address").order("address", { ascending: true }),
      supabase
        .from("tenancies")
        .select("id, property:properties(address), tenants(name, is_primary)")
        .order("created_at", { ascending: false }),
    ]);

  const allOrders = (woData ?? []) as unknown as WorkOrderRow[];
  const trades = (tradeData ?? []) as TradeRow[];
  const properties = (propData ?? []) as PropertyRef[];
  const activeTrades = trades.filter((t) => !t.archived);

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
  const woError =
    searchParams.wo && !WO_SUCCESS[searchParams.wo]
      ? workOrderErrorMessage(searchParams.wo)
      : null;
  const tradeError =
    searchParams.trade && !TRADE_SUCCESS[searchParams.trade]
      ? workOrderErrorMessage(searchParams.trade)
      : null;

  const editId = searchParams.edit ?? "";

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
          <a href="#new-work-order" className={PRIMARY_ACTION_CLASS} style={{ background: "var(--brand-gradient, var(--brand-color))" }}>
            New work order
          </a>
        }
      />

      {(woFlash || tradeFlash) && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {woFlash ?? tradeFlash}
        </div>
      )}
      {(woError || tradeError) && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {woError ?? tradeError}
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Open work orders" value={openCount} hint="Not yet completed or cancelled" icon={<Icons.bolt className="h-4 w-4" />} />
        <StatCard label="Urgent & open" value={urgentOpen} hint="Marked urgent, still active" icon={<Icons.clock className="h-4 w-4" />} />
        <StatCard label="Spent this month" value={formatMoneyCents(monthSpend)} hint="Completed work, current month" icon={<Icons.card className="h-4 w-4" />} />
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
                        <dt className="inline font-medium text-gray-600">Unit: </dt>
                        <dd className="inline">{o.property?.address ?? "—"}</dd>
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
                    <div>
                      <label className={labelCls}>Unit (optional)</label>
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
                      <label className={labelCls}>Cost (optional)</label>
                      <input name="cost" defaultValue={o.cost_cents != null ? (o.cost_cents / 100).toFixed(2) : ""} inputMode="decimal" placeholder="0.00" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Scheduled for (optional)</label>
                      <input type="date" name="scheduled_for" defaultValue={o.scheduled_for ?? ""} className={inputCls} />
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
            <div>
              <label className={labelCls}>Unit (optional)</label>
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
              <label className={labelCls}>Cost (optional)</label>
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
    </div>
  );
}

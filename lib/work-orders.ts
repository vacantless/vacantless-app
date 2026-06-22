// Pure maintenance work-order domain model (no I/O) so it can be unit-tested in
// isolation.
//
// A work order is a tracked maintenance job: an issue on a unit that the owner
// assigns to one of THEIR OWN trade contacts, moves through a status lifecycle,
// and attaches a cost to. We record the owner's work; we never dispatch a trade
// or move money (the owner pays their trades directly). See migration 0054.
//
// The status / category / priority value sets are small whitelists with label +
// tone maps, deliberately easy to extend (the DB CHECK + the constant here are
// the only two places to touch), exactly like lib/payments.ts `method`.
//
// Money + date parsing/formatting is REUSED from lib/payments.ts (parseAmountToCents,
// parseDateOrNull, formatMoneyCents) so there is one ledger-money source of truth.

import { parseDateOrNull, formatMoneyCents } from "./payments";

export { parseDateOrNull, formatMoneyCents };

// --- Value sets -------------------------------------------------------------

export const WORK_ORDER_STATUSES = [
  "open",
  "assigned",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const WORK_ORDER_CATEGORIES = [
  "plumbing",
  "electrical",
  "hvac",
  "appliance",
  "structural",
  "pest",
  "landscaping",
  "cleaning",
  "general",
] as const;
export type WorkOrderCategory = (typeof WORK_ORDER_CATEGORIES)[number];

export const WORK_ORDER_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: "Open",
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const CATEGORY_LABELS: Record<WorkOrderCategory, string> = {
  plumbing: "Plumbing",
  electrical: "Electrical",
  hvac: "Heating / cooling",
  appliance: "Appliance",
  structural: "Structural",
  pest: "Pest control",
  landscaping: "Landscaping",
  cleaning: "Cleaning",
  general: "General",
};

const PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

// Badge tone keys, matching the convention used by components/ui status badges.
const STATUS_TONES: Record<WorkOrderStatus, "gray" | "blue" | "amber" | "green" | "red"> = {
  open: "amber",
  assigned: "blue",
  in_progress: "blue",
  completed: "green",
  cancelled: "gray",
};

const PRIORITY_TONES: Record<WorkOrderPriority, "gray" | "blue" | "amber" | "red"> = {
  low: "gray",
  normal: "blue",
  high: "amber",
  urgent: "red",
};

export function workOrderStatusLabel(status: string): string {
  return (STATUS_LABELS as Record<string, string>)[status] ?? status;
}
export function workOrderCategoryLabel(category: string): string {
  return (CATEGORY_LABELS as Record<string, string>)[category] ?? category;
}
export function workOrderPriorityLabel(priority: string): string {
  return (PRIORITY_LABELS as Record<string, string>)[priority] ?? priority;
}
export function workOrderStatusTone(status: string): "gray" | "blue" | "amber" | "green" | "red" {
  return (STATUS_TONES as Record<string, "gray" | "blue" | "amber" | "green" | "red">)[status] ?? "gray";
}
export function workOrderPriorityTone(priority: string): "gray" | "blue" | "amber" | "red" {
  return (PRIORITY_TONES as Record<string, "gray" | "blue" | "amber" | "red">)[priority] ?? "gray";
}

export function isWorkOrderStatus(value: string): value is WorkOrderStatus {
  return (WORK_ORDER_STATUSES as readonly string[]).includes(value);
}
export function isWorkOrderCategory(value: string): value is WorkOrderCategory {
  return (WORK_ORDER_CATEGORIES as readonly string[]).includes(value);
}
export function isWorkOrderPriority(value: string): value is WorkOrderPriority {
  return (WORK_ORDER_PRIORITIES as readonly string[]).includes(value);
}

// --- Status lifecycle -------------------------------------------------------
//
// The heart of the module. Forward-flowing but forgiving: an operator can jump
// ahead (open -> completed for a same-day fix), step back (assigned -> open to
// unassign), cancel from any active state, reopen a completed job to fix a
// mistake, or reactivate a cancelled one. A no-op (from === to) is NOT a
// transition. Anything not listed is rejected.
const TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  open: ["assigned", "in_progress", "completed", "cancelled"],
  assigned: ["open", "in_progress", "completed", "cancelled"],
  in_progress: ["assigned", "completed", "cancelled"],
  completed: ["in_progress"], // reopen to fix
  cancelled: ["open"], // reactivate
};

export function nextStatuses(from: string): WorkOrderStatus[] {
  if (!isWorkOrderStatus(from)) return [];
  return [...TRANSITIONS[from]];
}

export function isValidStatusTransition(from: string, to: string): boolean {
  if (!isWorkOrderStatus(from) || !isWorkOrderStatus(to)) return false;
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}

// --- Validation -------------------------------------------------------------

export type WorkOrderInput = {
  title: string;
  category: string; // blank -> defaults to "general"
  priority: string; // blank -> defaults to "normal"
  costCents: number | null;
};
export type WorkOrderValidation =
  | {
      ok: true;
      value: {
        title: string;
        category: WorkOrderCategory;
        priority: WorkOrderPriority;
        costCents: number | null;
      };
    }
  | { ok: false; code: string };

/**
 * Validate a create/edit work-order submission. Title is required; category and
 * priority default when blank but must be known if provided; cost (if present)
 * must be >= 0. Status changes are validated separately (validateStatusChange).
 */
export function validateWorkOrderInput(v: WorkOrderInput): WorkOrderValidation {
  const title = (v.title ?? "").trim();
  if (!title) return { ok: false, code: "title" };

  const rawCat = (v.category ?? "").trim();
  const category = rawCat === "" ? "general" : rawCat;
  if (!isWorkOrderCategory(category)) return { ok: false, code: "category" };

  const rawPri = (v.priority ?? "").trim();
  const priority = rawPri === "" ? "normal" : rawPri;
  if (!isWorkOrderPriority(priority)) return { ok: false, code: "priority" };

  if (v.costCents != null && v.costCents < 0) return { ok: false, code: "cost" };

  return { ok: true, value: { title, category, priority, costCents: v.costCents ?? null } };
}

export type StatusChangeValidation =
  | { ok: true; value: { status: WorkOrderStatus; completedOn: string | null } }
  | { ok: false; code: string };

/**
 * Validate a status change. The target must be a known status, the transition
 * must be allowed, and moving to "completed" requires a completion date. Moving
 * to any non-completed state clears completed_on (returned as null) so a reopened
 * job doesn't keep a stale completion date.
 */
export function validateStatusChange(
  from: string,
  to: string,
  completedOn: string | null,
): StatusChangeValidation {
  if (!isWorkOrderStatus(to)) return { ok: false, code: "status" };
  if (!isValidStatusTransition(from, to)) return { ok: false, code: "transition" };
  if (to === "completed") {
    const d = parseDateOrNull(completedOn);
    if (!d) return { ok: false, code: "completed_date" };
    return { ok: true, value: { status: to, completedOn: d } };
  }
  return { ok: true, value: { status: to, completedOn: null } };
}

export type TradeContactInput = {
  name: string;
  email: string | null;
};
export type TradeContactValidation =
  | { ok: true; value: { name: string; email: string | null } }
  | { ok: false; code: string };

/**
 * Validate a trade-contact submission. Name is required; email, if provided, must
 * look like an email. Phone/trade_type/note are free text (no validation).
 */
export function validateTradeContactInput(v: TradeContactInput): TradeContactValidation {
  const name = (v.name ?? "").trim();
  if (!name) return { ok: false, code: "name" };
  const email = (v.email ?? "").trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, code: "email" };
  return { ok: true, value: { name, email: email || null } };
}

const ERROR_MESSAGES: Record<string, string> = {
  title: "Give the work order a short title.",
  category: "Pick a valid category.",
  priority: "Pick a valid priority.",
  cost: "Cost can't be negative.",
  status: "That isn't a valid status.",
  transition: "You can't move the work order to that status from where it is.",
  completed_date: "Enter the date the work was completed.",
  name: "Enter the trade contact's name.",
  email: "Enter a valid email address, or leave it blank.",
  forbidden: "You don't have permission to manage work orders.",
  notfound: "That work order could not be found.",
};

export function workOrderErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? "Something went wrong. Please check the form.";
}

// --- Cost rollups (feed the future financial-statement / reconciliation export) ---

export type WorkOrderCostRow = {
  property_id: string | null;
  category: string;
  status: string;
  cost_cents: number | null;
  completed_on: string | null;
};

export type CostFilter = {
  /** Inclusive lower bound on completed_on ("YYYY-MM-DD"). */
  from?: string;
  /** Inclusive upper bound on completed_on ("YYYY-MM-DD"). */
  to?: string;
  /** Only rows in this status. */
  status?: string;
};

function passesFilter(row: WorkOrderCostRow, f: CostFilter): boolean {
  if (f.status && row.status !== f.status) return false;
  if (f.from || f.to) {
    const d = row.completed_on;
    if (!d) return false; // a date window only includes dated (completed) rows
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
  }
  return true;
}

/** Total cost across rows (ignoring rows with no cost). String date compare. */
export function sumCostCents(rows: WorkOrderCostRow[], filter: CostFilter = {}): number {
  let total = 0;
  for (const r of rows) {
    if (r.cost_cents == null) continue;
    if (!passesFilter(r, filter)) continue;
    total += r.cost_cents;
  }
  return total;
}

export type CostBucket<K> = { key: K; totalCents: number; count: number };

/** Cost grouped by property (null property_id buckets under null). */
export function groupCostByProperty(
  rows: WorkOrderCostRow[],
  filter: CostFilter = {},
): CostBucket<string | null>[] {
  const by = new Map<string | null, { total: number; count: number }>();
  for (const r of rows) {
    if (r.cost_cents == null) continue;
    if (!passesFilter(r, filter)) continue;
    const key = r.property_id ?? null;
    const cur = by.get(key) ?? { total: 0, count: 0 };
    cur.total += r.cost_cents;
    cur.count += 1;
    by.set(key, cur);
  }
  return [...by.entries()].map(([key, v]) => ({ key, totalCents: v.total, count: v.count }));
}

/** Cost grouped by category. */
export function groupCostByCategory(
  rows: WorkOrderCostRow[],
  filter: CostFilter = {},
): CostBucket<string>[] {
  const by = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    if (r.cost_cents == null) continue;
    if (!passesFilter(r, filter)) continue;
    const cur = by.get(r.category) ?? { total: 0, count: 0 };
    cur.total += r.cost_cents;
    cur.count += 1;
    by.set(r.category, cur);
  }
  return [...by.entries()].map(([key, v]) => ({ key, totalCents: v.total, count: v.count }));
}

// Open / active work is anything not terminal — handy for the Overview tile.
export function isActiveStatus(status: string): boolean {
  return status === "open" || status === "assigned" || status === "in_progress";
}

// --- Tenant comms tie-in (Slice 4) ------------------------------------------
//
// When a work order changes status, the owner can let the tenant know with a
// branded update sent through the EXISTING tenant-comms engine — we don't add a
// new message system here. This maps a work-order status to the matching
// maintenance template (seeded in TENANT_MESSAGE_TEMPLATE_SEED, lib/tenant-comms)
// by NAME, so the composer can pre-load it. Pure + tested; the UI resolves the
// name to a saved-template id (and degrades to no preselection if the operator
// renamed or deleted that template). "cancelled" maps to nothing — a cancelled
// job isn't a tenant-facing update.

const STATUS_TEMPLATE_NAMES: Partial<Record<WorkOrderStatus, string>> = {
  open: "Maintenance request received",
  assigned: "Maintenance scheduled",
  in_progress: "Maintenance scheduled",
  completed: "Maintenance completed",
};

/**
 * The seed maintenance-template NAME that best matches a work-order status, or
 * null when no tenant update is appropriate (cancelled, or an unknown status).
 * Used to pre-load the tenant-message composer after a status change.
 */
export function maintenanceTemplateNameForStatus(status: string): string | null {
  return STATUS_TEMPLATE_NAMES[status as WorkOrderStatus] ?? null;
}

/** Whether a status is worth offering the owner a tenant update for. */
export function statusOffersTenantUpdate(status: string): boolean {
  return maintenanceTemplateNameForStatus(status) !== null;
}

/**
 * Case-insensitive lookup of a saved template's id by name. Returns null when
 * the name is empty or no template matches — so a renamed/deleted template just
 * means the composer opens with nothing pre-selected (never an error).
 */
export function findTemplateIdByName(
  templates: ReadonlyArray<{ id: string; name: string }>,
  name: string | null,
): string | null {
  if (!name) return null;
  const target = name.trim().toLowerCase();
  const hit = templates.find((t) => t.name.trim().toLowerCase() === target);
  return hit ? hit.id : null;
}

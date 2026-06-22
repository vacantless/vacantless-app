// Unit tests for the pure work-order domain model. Run: npx tsx scripts/test-work-orders.ts
import {
  WORK_ORDER_STATUSES,
  WORK_ORDER_CATEGORIES,
  WORK_ORDER_PRIORITIES,
  workOrderStatusLabel,
  workOrderCategoryLabel,
  workOrderPriorityLabel,
  workOrderStatusTone,
  workOrderPriorityTone,
  isWorkOrderStatus,
  isWorkOrderCategory,
  isWorkOrderPriority,
  nextStatuses,
  isValidStatusTransition,
  validateWorkOrderInput,
  validateStatusChange,
  validateTradeContactInput,
  workOrderErrorMessage,
  sumCostCents,
  groupCostByProperty,
  groupCostByCategory,
  isActiveStatus,
  maintenanceTemplateNameForStatus,
  statusOffersTenantUpdate,
  findTemplateIdByName,
  type WorkOrderCostRow,
} from "../lib/work-orders";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- Value sets -------------------------------------------------------------
ok("statuses", WORK_ORDER_STATUSES.join(",") === "open,assigned,in_progress,completed,cancelled");
ok("categories has 9", WORK_ORDER_CATEGORIES.length === 9);
ok("priorities", WORK_ORDER_PRIORITIES.join(",") === "low,normal,high,urgent");

ok("isWorkOrderStatus accepts known", WORK_ORDER_STATUSES.every((s) => isWorkOrderStatus(s)));
ok("isWorkOrderStatus rejects unknown", !isWorkOrderStatus("done"));
ok("isWorkOrderCategory accepts known", WORK_ORDER_CATEGORIES.every((c) => isWorkOrderCategory(c)));
ok("isWorkOrderCategory rejects unknown", !isWorkOrderCategory("roofing"));
ok("isWorkOrderPriority accepts known", WORK_ORDER_PRIORITIES.every((p) => isWorkOrderPriority(p)));
ok("isWorkOrderPriority rejects unknown", !isWorkOrderPriority("critical"));

// --- Labels + tones ---------------------------------------------------------
ok("status label in_progress", workOrderStatusLabel("in_progress") === "In progress");
ok("status label passthrough", workOrderStatusLabel("zzz") === "zzz");
ok("category label hvac", workOrderCategoryLabel("hvac") === "Heating / cooling");
ok("priority label urgent", workOrderPriorityLabel("urgent") === "Urgent");
ok("status tone completed = green", workOrderStatusTone("completed") === "green");
ok("status tone open = amber", workOrderStatusTone("open") === "amber");
ok("status tone unknown = gray", workOrderStatusTone("zzz") === "gray");
ok("priority tone urgent = red", workOrderPriorityTone("urgent") === "red");
ok("priority tone unknown = gray", workOrderPriorityTone("zzz") === "gray");

// --- Status lifecycle -------------------------------------------------------
ok("open -> assigned valid", isValidStatusTransition("open", "assigned"));
ok("open -> completed valid (same-day fix)", isValidStatusTransition("open", "completed"));
ok("in_progress -> completed valid", isValidStatusTransition("in_progress", "completed"));
ok("assigned -> open valid (unassign)", isValidStatusTransition("assigned", "open"));
ok("completed -> in_progress valid (reopen)", isValidStatusTransition("completed", "in_progress"));
ok("cancelled -> open valid (reactivate)", isValidStatusTransition("cancelled", "open"));
ok("any active -> cancelled valid", isValidStatusTransition("in_progress", "cancelled"));
ok("completed -> open INVALID", !isValidStatusTransition("completed", "open"));
ok("completed -> cancelled INVALID", !isValidStatusTransition("completed", "cancelled"));
ok("cancelled -> completed INVALID", !isValidStatusTransition("cancelled", "completed"));
ok("no-op same status is NOT a transition", !isValidStatusTransition("open", "open"));
ok("unknown from -> false", !isValidStatusTransition("zzz", "open"));
ok("unknown to -> false", !isValidStatusTransition("open", "zzz"));
ok("nextStatuses(open) has 4", nextStatuses("open").length === 4);
ok("nextStatuses(completed) = [in_progress]", nextStatuses("completed").join(",") === "in_progress");
ok("nextStatuses(unknown) = []", nextStatuses("zzz").length === 0);

// --- validateWorkOrderInput -------------------------------------------------
ok(
  "valid input cleans + defaults",
  (() => {
    const r = validateWorkOrderInput({ title: "  Leaky tap ", category: "", priority: "", costCents: null });
    return r.ok && r.value.title === "Leaky tap" && r.value.category === "general" && r.value.priority === "normal";
  })(),
);
ok("blank title rejected", matchCode(validateWorkOrderInput({ title: "  ", category: "plumbing", priority: "high", costCents: null }), "title"));
ok("bad category rejected", matchCode(validateWorkOrderInput({ title: "x", category: "roofing", priority: "high", costCents: null }), "category"));
ok("bad priority rejected", matchCode(validateWorkOrderInput({ title: "x", category: "plumbing", priority: "critical", costCents: null }), "priority"));
ok("negative cost rejected", matchCode(validateWorkOrderInput({ title: "x", category: "plumbing", priority: "high", costCents: -1 }), "cost"));
ok(
  "zero cost allowed",
  (() => {
    const r = validateWorkOrderInput({ title: "x", category: "plumbing", priority: "high", costCents: 0 });
    return r.ok && r.value.costCents === 0;
  })(),
);
ok(
  "explicit valid category/priority kept",
  (() => {
    const r = validateWorkOrderInput({ title: "Fix", category: "hvac", priority: "urgent", costCents: 12500 });
    return r.ok && r.value.category === "hvac" && r.value.priority === "urgent" && r.value.costCents === 12500;
  })(),
);

// --- validateStatusChange ---------------------------------------------------
ok(
  "to completed needs a date",
  matchCode(validateStatusChange("in_progress", "completed", null), "completed_date"),
);
ok(
  "to completed with date ok + keeps date",
  (() => {
    const r = validateStatusChange("in_progress", "completed", "2026-06-22");
    return r.ok && r.value.status === "completed" && r.value.completedOn === "2026-06-22";
  })(),
);
ok(
  "to completed with malformed date rejected",
  matchCode(validateStatusChange("in_progress", "completed", "06/22/2026"), "completed_date"),
);
ok(
  "non-completed clears completed_on",
  (() => {
    const r = validateStatusChange("completed", "in_progress", "2026-06-22");
    return r.ok && r.value.status === "in_progress" && r.value.completedOn === null;
  })(),
);
ok("illegal transition rejected", matchCode(validateStatusChange("completed", "open", null), "transition"));
ok("unknown target rejected", matchCode(validateStatusChange("open", "done", null), "status"));

// --- validateTradeContactInput ----------------------------------------------
ok(
  "trade contact valid",
  (() => {
    const r = validateTradeContactInput({ name: "  Joe Plumber ", email: " joe@example.com " });
    return r.ok && r.value.name === "Joe Plumber" && r.value.email === "joe@example.com";
  })(),
);
ok(
  "trade contact blank email -> null",
  (() => {
    const r = validateTradeContactInput({ name: "Joe", email: "" });
    return r.ok && r.value.email === null;
  })(),
);
ok("trade contact blank name rejected", matchCode(validateTradeContactInput({ name: "  ", email: null }), "name"));
ok("trade contact bad email rejected", matchCode(validateTradeContactInput({ name: "Joe", email: "not-an-email" }), "email"));

// --- error messages ---------------------------------------------------------
ok("error message known", workOrderErrorMessage("title") === "Give the work order a short title.");
ok("error message unknown -> generic", (workOrderErrorMessage("weird") ?? "").startsWith("Something went wrong"));
ok("error message undefined -> null", workOrderErrorMessage(undefined) === null);

// --- Cost rollups -----------------------------------------------------------
const costRows: WorkOrderCostRow[] = [
  { property_id: "A", category: "plumbing", status: "completed", cost_cents: 10000, completed_on: "2026-01-15" },
  { property_id: "A", category: "hvac", status: "completed", cost_cents: 25000, completed_on: "2026-03-10" },
  { property_id: "B", category: "plumbing", status: "completed", cost_cents: 5000, completed_on: "2026-02-20" },
  { property_id: "A", category: "general", status: "in_progress", cost_cents: null, completed_on: null }, // no cost -> ignored
  { property_id: null, category: "cleaning", status: "completed", cost_cents: 3000, completed_on: "2026-12-31" },
];

ok("sum all costed rows", sumCostCents(costRows) === 43000);
ok("sum ignores null-cost rows", sumCostCents(costRows) === 10000 + 25000 + 5000 + 3000);
ok("sum filtered by status", sumCostCents(costRows, { status: "in_progress" }) === 0);
ok("sum filtered by date window", sumCostCents(costRows, { from: "2026-01-01", to: "2026-03-31" }) === 40000);
ok("sum date window excludes undated", sumCostCents(costRows, { from: "2026-01-01", to: "2026-12-31" }) === 43000);
ok(
  "groupCostByProperty buckets A/B/null",
  (() => {
    const g = groupCostByProperty(costRows);
    const a = g.find((b) => b.key === "A");
    const b = g.find((x) => x.key === "B");
    const n = g.find((x) => x.key === null);
    return g.length === 3 && a?.totalCents === 35000 && a?.count === 2 && b?.totalCents === 5000 && n?.totalCents === 3000;
  })(),
);
ok(
  "groupCostByCategory sums plumbing across properties",
  (() => {
    const g = groupCostByCategory(costRows);
    const plumb = g.find((b) => b.key === "plumbing");
    return plumb?.totalCents === 15000 && plumb?.count === 2;
  })(),
);

// --- isActiveStatus ---------------------------------------------------------
ok("open is active", isActiveStatus("open"));
ok("assigned is active", isActiveStatus("assigned"));
ok("in_progress is active", isActiveStatus("in_progress"));
ok("completed is not active", !isActiveStatus("completed"));
ok("cancelled is not active", !isActiveStatus("cancelled"));

function matchCode(v: { ok: boolean; code?: string }, code: string): boolean {
  return v.ok === false && v.code === code;
}

// --- Tenant comms tie-in (Slice 4) ------------------------------------------
ok(
  "open maps to request-received template",
  maintenanceTemplateNameForStatus("open") === "Maintenance request received",
);
ok(
  "assigned maps to scheduled template",
  maintenanceTemplateNameForStatus("assigned") === "Maintenance scheduled",
);
ok(
  "in_progress maps to scheduled template",
  maintenanceTemplateNameForStatus("in_progress") === "Maintenance scheduled",
);
ok(
  "completed maps to completed template",
  maintenanceTemplateNameForStatus("completed") === "Maintenance completed",
);
ok("cancelled maps to no template", maintenanceTemplateNameForStatus("cancelled") === null);
ok("unknown status maps to no template", maintenanceTemplateNameForStatus("bogus") === null);

ok("open offers a tenant update", statusOffersTenantUpdate("open"));
ok("completed offers a tenant update", statusOffersTenantUpdate("completed"));
ok("cancelled offers no tenant update", !statusOffersTenantUpdate("cancelled"));
ok("unknown offers no tenant update", !statusOffersTenantUpdate("bogus"));

const sampleTemplates = [
  { id: "t1", name: "Maintenance scheduled" },
  { id: "t2", name: "Maintenance completed" },
  { id: "t3", name: "Rent reminder" },
];
ok(
  "findTemplateIdByName matches exactly",
  findTemplateIdByName(sampleTemplates, "Maintenance completed") === "t2",
);
ok(
  "findTemplateIdByName is case/space insensitive",
  findTemplateIdByName(sampleTemplates, "  maintenance SCHEDULED ") === "t1",
);
ok("findTemplateIdByName returns null on miss", findTemplateIdByName(sampleTemplates, "Nope") === null);
ok("findTemplateIdByName returns null on null name", findTemplateIdByName(sampleTemplates, null) === null);
ok(
  "status->template->id resolves end to end",
  findTemplateIdByName(sampleTemplates, maintenanceTemplateNameForStatus("completed")) === "t2",
);

console.log(`\nwork-orders: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

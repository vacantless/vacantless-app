import {
  RESPONSIBLE_PARTIES,
  UTILITY_TASK_STATUSES,
  buildDefaultUtilityTasks,
  isResponsibleParty,
  isUtilityTaskStatus,
  normalizeUtilityTask,
  responsiblePartyLabel,
  utilityTaskStatusLabel,
} from "../lib/utility-tasks";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

for (const status of UTILITY_TASK_STATUSES) {
  ok(`${status} status accepted`, isUtilityTaskStatus(status));
}
ok("junk status rejected", !isUtilityTaskStatus("waiting"));
ok("blank status rejected", !isUtilityTaskStatus(""));
ok("todo label maps", utilityTaskStatusLabel("todo") === "To do");
ok("in_progress label maps", utilityTaskStatusLabel("in_progress") === "In progress");
ok("unknown status label falls back", utilityTaskStatusLabel("waiting") === "To do");

for (const party of RESPONSIBLE_PARTIES) {
  ok(`${party} party accepted`, isResponsibleParty(party));
}
ok("junk party rejected", !isResponsibleParty("property_manager"));
ok("tenant label maps", responsiblePartyLabel("tenant") === "Tenant");
ok("landlord label maps", responsiblePartyLabel("landlord") === "Landlord");
ok("unknown party label falls back", responsiblePartyLabel("manager") === "Tenant");

const defaults = buildDefaultUtilityTasks();
ok("default utility tasks have rows", defaults.length > 0);
ok(
  "default utility sort order is ascending",
  defaults.every((task, index) => task.sort_order === index),
);
ok(
  "default utility labels are non-blank",
  defaults.every((task) => task.label.trim().length > 0),
);
ok(
  "default utility statuses are valid",
  defaults.every((task) => isUtilityTaskStatus(task.status ?? "")),
);
ok(
  "default utility responsible parties are valid",
  defaults.every((task) => isResponsibleParty(task.responsible_party ?? "")),
);

const normalized = normalizeUtilityTask({
  label: " Hydro transfer ",
  responsible_party: "landlord",
  target_date: "2026-09-01",
  status: "in_progress",
  confirmation_note: " Account request sent ",
});
ok("normalize trims label", normalized?.label === "Hydro transfer");
ok("normalize preserves valid party", normalized?.responsible_party === "landlord");
ok("normalize preserves valid status", normalized?.status === "in_progress");
ok("normalize preserves valid date", normalized?.target_date === "2026-09-01");
ok("normalize trims note", normalized?.confirmation_note === "Account request sent");

const coerced = normalizeUtilityTask({
  label: "Internet",
  responsible_party: "manager",
  target_date: "2026-99-99",
  status: "waiting",
  confirmation_note: "",
});
ok("normalize coerces invalid party", coerced?.responsible_party === "tenant");
ok("normalize coerces invalid status", coerced?.status === "todo");
ok("normalize drops invalid date", coerced?.target_date === null);
ok("normalize blanks note to null", coerced?.confirmation_note === null);
ok("normalize blank target date to null", normalizeUtilityTask({ label: "Gas", target_date: "" })?.target_date === null);
ok("normalize rejects blank label", normalizeUtilityTask({ label: "   " }) === null);

if (failed > 0) {
  console.error(`utility-tasks: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`utility-tasks: ${passed} passed, 0 failed`);

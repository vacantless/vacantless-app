import {
  CHECKLIST_CONDITIONS,
  buildDefaultChecklistItems,
  checklistConditionLabel,
  isChecklistCondition,
  normalizeChecklistItem,
} from "../lib/inspection-checklist";

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

for (const condition of CHECKLIST_CONDITIONS) {
  ok(`${condition} is accepted`, isChecklistCondition(condition));
}

ok("junk condition is rejected", !isChecklistCondition("excellent"));
ok("blank condition is rejected", !isChecklistCondition(""));
ok("good label maps", checklistConditionLabel("good") === "Good");
ok("na label maps", checklistConditionLabel("na") === "N/A");
ok("blank label falls back", checklistConditionLabel("") === "Not rated");
ok("unknown label falls back", checklistConditionLabel("excellent") === "Not rated");

const defaults = buildDefaultChecklistItems();
ok("default checklist has rows", defaults.length > 0);
ok(
  "default checklist includes required areas",
  ["Kitchen", "Bathroom", "Bedroom", "Living/Common", "General"].every((area) =>
    defaults.some((row) => row.area === area),
  ),
);
ok(
  "default sort order is ascending from zero",
  defaults.every((row, index) => row.sort_order === index),
);
ok(
  "default sort order is unique",
  new Set(defaults.map((row) => row.sort_order)).size === defaults.length,
);
ok(
  "default items are non-blank",
  defaults.every((row) => row.item.trim().length > 0),
);

const normalized = normalizeChecklistItem({
  area: " Kitchen ",
  item: " Sink ",
  condition: "damaged",
  note: " Drips under cabinet ",
});
ok("normalize trims item", normalized?.item === "Sink");
ok("normalize trims area", normalized?.area === "Kitchen");
ok("normalize preserves valid condition", normalized?.condition === "damaged");
ok("normalize trims note", normalized?.note === "Drips under cabinet");

const invalidCondition = normalizeChecklistItem({
  area: "",
  item: "Window",
  condition: "excellent",
  note: "",
});
ok("normalize blanks area to null", invalidCondition?.area === null);
ok("normalize drops invalid condition", invalidCondition?.condition === null);
ok("normalize blanks note to null", invalidCondition?.note === null);
ok(
  "normalize rejects blank item",
  normalizeChecklistItem({ item: "   ", condition: "good" }) === null,
);

if (failed > 0) {
  console.error(`inspection-checklist: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`inspection-checklist: ${passed} passed, 0 failed`);

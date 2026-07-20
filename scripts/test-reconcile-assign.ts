// Unit tests for the pure reconcile assignment resolver. Run: npx tsx scripts/test-reconcile-assign.ts
import { chooseReconcileAssignment, type ResolvedAssignment } from "../lib/reconcile-assign";

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

function same(name: string, actual: ResolvedAssignment, expected: ResolvedAssignment) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected));
}

same(
  "explicit valid category overrides rule suggestion",
  chooseReconcileAssignment(
    { category: "utilities", propertyId: null, buildingKey: null },
    { category: "maintenance", propertyId: "p1", buildingKey: null },
  ),
  { category: "utilities", propertyId: null, buildingKey: null },
);

same(
  "explicit category carries property and normalizes blank building",
  chooseReconcileAssignment(
    { category: "insurance", propertyId: "p2", buildingKey: "" },
    { category: "maintenance", propertyId: null, buildingKey: "b1" },
  ),
  { category: "insurance", propertyId: "p2", buildingKey: null },
);

same(
  "explicit category carries building and normalizes blank property",
  chooseReconcileAssignment(
    { category: "property_tax", propertyId: "", buildingKey: "100 king st" },
    null,
  ),
  { category: "property_tax", propertyId: null, buildingKey: "100 king st" },
);

same(
  "invalid category with rule suggestion returns suggestion",
  chooseReconcileAssignment(
    { category: "", propertyId: "operator-pick", buildingKey: null },
    { category: "maintenance", propertyId: "rule-pick", buildingKey: null },
  ),
  { category: "maintenance", propertyId: "rule-pick", buildingKey: null },
);

same(
  "no category and no suggestion falls back to other",
  chooseReconcileAssignment({ category: "", propertyId: null, buildingKey: null }, null),
  { category: "other", propertyId: null, buildingKey: null },
);

same(
  "invalid category with no suggestion never returns invalid category",
  chooseReconcileAssignment({ category: "bogus", propertyId: null, buildingKey: null }, null),
  { category: "other", propertyId: null, buildingKey: null },
);

same(
  "property only passes through independently",
  chooseReconcileAssignment({ category: "travel", propertyId: "p3", buildingKey: null }, null),
  { category: "travel", propertyId: "p3", buildingKey: null },
);

same(
  "building only passes through independently",
  chooseReconcileAssignment({ category: "supplies", propertyId: null, buildingKey: "200 bay st" }, null),
  { category: "supplies", propertyId: null, buildingKey: "200 bay st" },
);

console.log(`PASS ${passed}/${passed + failed}`);
if (failed > 0) process.exit(1);

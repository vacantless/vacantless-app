import { readFileSync } from "fs";
import { listingCapForPlan } from "../lib/billing";

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

type PropertyRow = {
  id: string;
  status: string | null;
  archived_at: string | null;
};

function activeListingCount(rows: PropertyRow[], excludeId: string): number {
  return rows.filter(
    (row) =>
      row.id !== excludeId &&
      row.status === "available" &&
      row.archived_at == null,
  ).length;
}

function legacyStatusOnlyCount(rows: PropertyRow[], excludeId: string): number {
  return rows.filter((row) => row.id !== excludeId && row.status === "available")
    .length;
}

function capBlocks(plan: string | null, rows: PropertyRow[], propertyId: string): boolean {
  const cap = listingCapForPlan(plan);
  if (cap == null) return false;
  return activeListingCount(rows, propertyId) >= cap;
}

const archivedAvailableFixture: PropertyRow[] = [
  {
    id: "archived-live",
    status: "available",
    archived_at: "2026-08-05T18:52:02.000Z",
  },
  { id: "candidate", status: "draft", archived_at: null },
];
const activeAvailableFixture: PropertyRow[] = [
  { id: "active-live", status: "available", archived_at: null },
  { id: "candidate", status: "draft", archived_at: null },
];

ok(
  "legacy status-only count would block one archived available listing",
  legacyStatusOnlyCount(archivedAvailableFixture, "candidate") >=
    (listingCapForPlan("free") ?? Number.POSITIVE_INFINITY),
);
ok(
  "free cap ignores archived available listing",
  !capBlocks("free", archivedAvailableFixture, "candidate"),
);
ok(
  "free cap still blocks one non-archived available listing",
  capBlocks("free", activeAvailableFixture, "candidate"),
);
for (const plan of ["growth", "premium", "managed", "pilot", "core", "plus"]) {
  ok(
    `${plan} cap is unlimited and never counts live rows`,
    !capBlocks(plan, activeAvailableFixture, "candidate"),
  );
}

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function sourceHas(path: string, name: string, pattern: RegExp) {
  ok(name, pattern.test(source(path)));
}

sourceHas(
  "app/dashboard/properties/actions.ts",
  "publishProperty cap count excludes archived rows",
  /\.select\("id", \{ count: "exact", head: true \}\)\s*\.eq\("status", "available"\)\s*\.is\("archived_at", null\)\s*\.neq\("id", id\)/,
);
sourceHas(
  "app/dashboard/properties/actions.ts",
  "relistLeasedProperty cap count excludes archived rows",
  /\.select\("id", \{ count: "exact", head: true \}\)\s*\.eq\("status", "available"\)\s*\.is\("archived_at", null\)\s*\.neq\("id", propertyId\)/,
);
sourceHas(
  "app/dashboard/properties/[id]/page.tsx",
  "property publish warning count excludes archived rows",
  /\.select\("id", \{ count: "exact", head: true \}\)\s*\.eq\("status", "available"\)\s*\.is\("archived_at", null\)\s*\.neq\("id", p\.id\)/,
);
sourceHas(
  "app/dashboard/properties/[id]/page.tsx",
  "property market-rent active comps exclude archived rows",
  /\.select\("address, rent_cents, beds, sqft, status"\)\s*\.eq\("organization_id", propertyOrgId\)\s*\.eq\("status", "available"\)\s*\.is\("archived_at", null\)/,
);
sourceHas(
  "app/dashboard/tenancies/[id]/page.tsx",
  "tenancy market-rent active comps exclude archived rows",
  /\.select\("address, rent_cents, beds, sqft, status"\)\s*\.eq\("organization_id", org\.id\)\s*\.eq\("status", "available"\)\s*\.is\("archived_at", null\)/,
);
sourceHas(
  "app/dashboard/page.tsx",
  "dashboard live public-page shortcut excludes archived rows",
  /\.select\("id"\)\s*\.eq\("organization_id", org\.id\)\s*\.eq\("status", "available"\)\s*\.is\("archived_at", null\)/,
);
sourceHas(
  "app/dashboard/leasing/screening/page.tsx",
  "screening preview bridge excludes archived rows",
  /\.select\("id"\)\s*\.eq\("organization_id", org\.id\)\s*\.eq\("status", "available"\)\s*\.is\("archived_at", null\)/,
);
sourceHas(
  "lib/leaseup-takedown.ts",
  "lease-up takedown sibling count excludes archived rows",
  /\.select\("id, beds, unit_type"\)\s*\.eq\("organization_id", org\.id\)\s*\.eq\("status", "available"\)\s*\.is\("archived_at", null\)/,
);
sourceHas(
  "app/api/cron/leasing-snapshot/route.ts",
  "leasing snapshot health posts exclude archived linked properties",
  /\.eq\("properties\.status", "available"\)\s*\.is\("properties\.archived_at", null\)/,
);
sourceHas(
  "app/api/cron/leasing-snapshot/route.ts",
  "leasing snapshot active listings exclude archived rows",
  /\.select\("id, address, status, created_at"\)\s*\.eq\("organization_id", org\.id\)\s*\.eq\("status", "available"\)\s*\.is\("archived_at", null\)/,
);
sourceHas(
  "app/api/cron/distribution-freshness/route.ts",
  "distribution freshness health posts exclude archived linked properties",
  /\.eq\("properties\.status", "available"\)\s*\.is\("properties\.archived_at", null\)/,
);

if (failed > 0) {
  console.error(`${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`${passed} passed, ${failed} failed`);

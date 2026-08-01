// Focused tests for additive document scope links.
// Run: npx tsx scripts/test-documents-scope.ts
import { readFileSync } from "fs";
import {
  documentBelongsToProperty,
  documentBelongsToTenancy,
  documentBelongsToWorkOrder,
  documentsForProperty,
  documentsForTenancy,
  documentsForWorkOrder,
  type DocumentScopeRowLike,
} from "../lib/documents";

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

function file(path: string): string {
  return readFileSync(path, "utf8");
}

const tenancyDoc = {
  id: "tenancy-only",
  tenancy_id: "tenancy-1",
  property_id: null,
  work_order_id: null,
};
const receiptDoc = {
  id: "receipt",
  tenancy_id: null,
  property_id: "property-1",
  work_order_id: "work-order-1",
};
const mixedDoc = {
  id: "mixed",
  tenancy_id: "tenancy-1",
  property_id: "property-1",
  work_order_id: null,
};
const docs = [tenancyDoc, receiptDoc, mixedDoc] satisfies (DocumentScopeRowLike & {
  id: string;
})[];

ok("tenancy doc belongs to tenancy", documentBelongsToTenancy(tenancyDoc, "tenancy-1"));
ok("tenancy doc does not belong to property", !documentBelongsToProperty(tenancyDoc, "property-1"));
ok("tenancy doc does not belong to work order", !documentBelongsToWorkOrder(tenancyDoc, "work-order-1"));
ok("receipt doc belongs to property", documentBelongsToProperty(receiptDoc, "property-1"));
ok("receipt doc belongs to work order", documentBelongsToWorkOrder(receiptDoc, "work-order-1"));
ok("receipt doc does not belong to tenancy", !documentBelongsToTenancy(receiptDoc, "tenancy-1"));
ok(
  "tenancy filter preserves tenancy-only behavior",
  documentsForTenancy(docs, "tenancy-1").map((d) => d.id).join(",") ===
    "tenancy-only,mixed",
);
ok(
  "property filter returns property-linked docs",
  documentsForProperty(docs, "property-1").map((d) => d.id).join(",") ===
    "receipt,mixed",
);
ok(
  "work-order filter returns receipt",
  documentsForWorkOrder(docs, "work-order-1").map((d) => d.id).join(",") === "receipt",
);

const migration = file("supabase/migrations/0202_documents_workorder_property_link.sql");
ok("migration adds documents.work_order_id", migration.includes("add column if not exists work_order_id uuid"));
ok("migration adds documents.property_id", migration.includes("add column if not exists property_id uuid"));
ok("migration leaves links nullable", !migration.includes("set not null"));
ok("migration indexes work-order scope", migration.includes("documents_work_order_idx"));
ok("migration indexes property scope", migration.includes("documents_property_idx"));

const tenancyPage = file("app/dashboard/tenancies/[id]/page.tsx");
const tenancyDocStart = tenancyPage.indexOf("// Document vault (Slices 1+2)");
const tenancyDocEnd = tenancyPage.indexOf("// Slice 4b (Option C)");
const tenancyDocBlock = tenancyPage.slice(tenancyDocStart, tenancyDocEnd);
ok("tenancy document block found", tenancyDocStart >= 0 && tenancyDocEnd > tenancyDocStart);
ok(
  "tenancy document select is unchanged",
  tenancyDocBlock.includes(
    '.select("id, title, doc_type, size_bytes, storage_path, created_at, person_id, source, lease_document_id")',
  ),
);
ok("tenancy document query stays tenancy-scoped", tenancyDocBlock.includes('.eq("tenancy_id", t.id)'));
ok("tenancy document query does not require property_id", !tenancyDocBlock.includes("property_id"));
ok("tenancy document query does not require work_order_id", !tenancyDocBlock.includes("work_order_id"));

const documentsServer = file("lib/documents-server.ts");
ok("upload helper writes work_order_id", documentsServer.includes("work_order_id: input.workOrderId ?? null"));
ok("upload helper writes property_id", documentsServer.includes("property_id: input.propertyId ?? null"));
ok("property list filters organization", documentsServer.includes(".eq(\"organization_id\", organizationId)"));
ok("property list filters property", documentsServer.includes(".eq(\"property_id\", propertyId)"));
ok("work-order list filters work order", documentsServer.includes(".in(\"work_order_id\", ids)"));

const maintenanceActions = file("app/dashboard/maintenance/actions.ts");
ok(
  "maintenance receipt action uses work-order gate",
  maintenanceActions.includes('requireCapability("manage_work_orders"') &&
    maintenanceActions.includes("uploadWorkOrderReceipt"),
);
ok("maintenance receipt action stores receipt type", maintenanceActions.includes('docType: "receipt"'));
ok("maintenance receipt action stores work order id", maintenanceActions.includes("workOrderId: workOrder.id"));
ok("maintenance receipt action stores property id", maintenanceActions.includes("propertyId: workOrder.property_id"));

const propertyActions = file("app/dashboard/properties/[id]/documents-actions.ts");
ok(
  "property actions use document gate",
  propertyActions.includes('requireCapability("manage_tenancies"'),
);
ok("property upload uses shared vault helper", propertyActions.includes("createUploadedVaultDocument"));
ok("property delete scopes document id to property", propertyActions.includes('.eq("property_id", propertyId)'));
ok("property share confirms property document", propertyActions.includes('.eq("property_id", propertyId)'));

const propertyPage = file("app/dashboard/properties/[id]/page.tsx");
ok("property page checks manage_tenancies for document list", propertyPage.includes('roleCan(propertyRole, "manage_tenancies")'));
ok("property page lists property documents", propertyPage.includes("listDocumentsForProperty"));
ok("property page hydrates share status", propertyPage.includes("shareLinkStatus"));
ok("property page renders documents section", propertyPage.includes("<PropertyDocumentsSection"));

if (failed > 0) {
  console.error(`documents-scope: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`documents-scope: ${passed} passed, 0 failed`);

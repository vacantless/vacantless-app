// Unit tests for the pure tenant-message approval queue model (S341 —
// approve_to_send tier). Run: npx tsx scripts/test-tenant-message-approvals.ts
import {
  validateTenantMessageEdit,
  canApproveTenantMessage,
  canDismissTenantMessage,
  tenantNoticeDedupeKey,
  MAX_TENANT_MESSAGE_SUBJECT_LEN,
  MAX_TENANT_MESSAGE_BODY_LEN,
  type PendingTenantMessageRow,
} from "../lib/tenant-message-approvals";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- validateTenantMessageEdit ----------------------------------------------
{
  const good = validateTenantMessageEdit({ subject: "  Hello  ", body: "  Hi there  " });
  ok("edit: trims + accepts", good.ok && good.value.subject === "Hello" && good.value.body === "Hi there");
  ok("edit: blank subject rejected", validateTenantMessageEdit({ subject: "   ", body: "x" }).ok === false);
  ok("edit: blank body rejected", validateTenantMessageEdit({ subject: "x", body: "" }).ok === false);
  ok("edit: null subject rejected", validateTenantMessageEdit({ subject: null, body: "x" }).ok === false);
  const longSub = validateTenantMessageEdit({ subject: "a".repeat(MAX_TENANT_MESSAGE_SUBJECT_LEN + 1), body: "x" });
  ok("edit: over-long subject rejected", !longSub.ok && longSub.code === "subject_too_long");
  const longBody = validateTenantMessageEdit({ subject: "x", body: "b".repeat(MAX_TENANT_MESSAGE_BODY_LEN + 1) });
  ok("edit: over-long body rejected", !longBody.ok && longBody.code === "body_too_long");
  ok(
    "edit: exact-max subject accepted",
    validateTenantMessageEdit({ subject: "a".repeat(MAX_TENANT_MESSAGE_SUBJECT_LEN), body: "x" }).ok,
  );
  // error codes are specific
  const e1 = validateTenantMessageEdit({ subject: "", body: "x" });
  ok("edit: empty_subject code", !e1.ok && e1.code === "empty_subject");
  const e2 = validateTenantMessageEdit({ subject: "x", body: "  " });
  ok("edit: empty_body code", !e2.ok && e2.code === "empty_body");
}

// --- canApproveTenantMessage ------------------------------------------------
{
  const base: PendingTenantMessageRow = {
    status: "pending",
    tenant_email: "tenant@example.com",
    subject: "Hi",
    body: "Body",
  };
  ok("approve: pending + valid email", canApproveTenantMessage(base));
  ok("approve: sent -> no", !canApproveTenantMessage({ ...base, status: "sent" }));
  ok("approve: dismissed -> no", !canApproveTenantMessage({ ...base, status: "dismissed" }));
  ok("approve: null email -> no", !canApproveTenantMessage({ ...base, tenant_email: null }));
  ok("approve: junk email -> no", !canApproveTenantMessage({ ...base, tenant_email: "not-an-email" }));
  ok("approve: blank subject -> no", !canApproveTenantMessage({ ...base, subject: "   " }));
  ok("approve: blank body -> no", !canApproveTenantMessage({ ...base, body: "" }));
}

// --- canDismissTenantMessage ------------------------------------------------
{
  const base: PendingTenantMessageRow = { status: "pending", tenant_email: null, subject: "x", body: "y" };
  ok("dismiss: pending -> yes (no email needed)", canDismissTenantMessage(base));
  ok("dismiss: sent -> no", !canDismissTenantMessage({ ...base, status: "sent" }));
  ok("dismiss: dismissed -> no", !canDismissTenantMessage({ ...base, status: "dismissed" }));
}

// --- tenantNoticeDedupeKey --------------------------------------------------
{
  const k = tenantNoticeDedupeKey("leasing.rent_increase_tenant_notice", "ten-123", "2026-10-01");
  ok("dedupe: composes stable key", k === "leasing.rent_increase_tenant_notice:ten-123:2026-10-01");
  ok(
    "dedupe: same inputs -> same key (idempotent)",
    tenantNoticeDedupeKey("e", "t", "d") === tenantNoticeDedupeKey("e", "t", "d"),
  );
  ok(
    "dedupe: different cycle -> different key",
    tenantNoticeDedupeKey("e", "t", "2026-10-01") !== tenantNoticeDedupeKey("e", "t", "2027-10-01"),
  );
}

// ---------------------------------------------------------------------------
console.log(`\ntenant-message-approvals: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

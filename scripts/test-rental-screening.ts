// Unit tests for the rental-screening seam pure helpers (Slice 2, S455).
// Run: npx tsx scripts/test-rental-screening.ts
import {
  canScreen,
  providerForPlan,
  payerForMode,
  buildInviteRequest,
  coerceReportStatus,
  normalizeRecommendation,
  applicationStatusForReport,
  nextApplicationStatus,
  isValidHandshake,
  parseReportCompleteWebhook,
} from "../lib/rental-screening/index";
import { normalizeSingleKeyReport, singleKeyConfigured } from "../lib/rental-screening/singlekey";
import { PLAN_ENTITLEMENTS } from "../lib/billing";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("rental-screening: Slice 2 seam");

// --- Entitlement gating (Growth+) -------------------------------------------
ok("growth can screen", canScreen(PLAN_ENTITLEMENTS.growth));
ok("premium can screen", canScreen(PLAN_ENTITLEMENTS.premium));
ok("free cannot screen", !canScreen(PLAN_ENTITLEMENTS.free));
ok("plus cannot screen", !canScreen(PLAN_ENTITLEMENTS.plus));
ok("core cannot screen", !canScreen(PLAN_ENTITLEMENTS.core));
ok("provider for growth = singlekey", providerForPlan(PLAN_ENTITLEMENTS.growth) === "singlekey");
ok("provider for free = null", providerForPlan(PLAN_ENTITLEMENTS.free) === null);

// --- pay mode -> payer ------------------------------------------------------
ok("applicant pay -> applicant payer", payerForMode("applicant") === "applicant");
ok("landlord pay -> landlord payer", payerForMode("landlord") === "landlord");

// --- buildInviteRequest -----------------------------------------------------
const good = buildInviteRequest({
  orgId: "org-1",
  personId: "person-1",
  applicantName: "Jane Renter",
  applicantEmail: "jane@example.com",
  applicantPhoneE164: "+15195551212",
  payMode: "applicant",
});
ok("valid invite request builds", good.ok === true);
ok("invite carries org as external_customer_id", good.ok && good.request.externalCustomerId === "org-1");
ok("invite carries person as external_tenant_id", good.ok && good.request.externalTenantId === "person-1");
ok("invite payer derived from pay mode", good.ok && good.request.payer === "applicant");

const landlordPay = buildInviteRequest({
  orgId: "org-1",
  personId: "person-1",
  applicantName: "Jane",
  applicantEmail: null,
  applicantPhoneE164: "+15195551212",
  payMode: "landlord",
});
ok("landlord-pay invite, phone-only contact ok", landlordPay.ok && landlordPay.request.payer === "landlord");

const noPerson = buildInviteRequest({
  orgId: "org-1",
  personId: "",
  applicantName: "Jane",
  applicantEmail: "jane@example.com",
  applicantPhoneE164: null,
  payMode: "applicant",
});
ok("missing person rejected", !noPerson.ok && !noPerson.ok && noPerson.errors.includes("person_required"));

const noContact = buildInviteRequest({
  orgId: "org-1",
  personId: "person-1",
  applicantName: "Jane",
  applicantEmail: "",
  applicantPhoneE164: "",
  payMode: "applicant",
});
ok("missing contact rejected", !noContact.ok && noContact.errors.includes("contact_required"));

const noOrg = buildInviteRequest({
  orgId: null,
  personId: "person-1",
  applicantName: "Jane",
  applicantEmail: "jane@example.com",
  applicantPhoneE164: null,
  payMode: "applicant",
});
ok("missing org rejected", !noOrg.ok && noOrg.errors.includes("org_required"));

// --- coerceReportStatus -----------------------------------------------------
ok("status: completed -> complete", coerceReportStatus("completed") === "complete");
ok("status: Report_Complete -> complete", coerceReportStatus("Report_Complete") === "complete");
ok("status: processing -> in_progress", coerceReportStatus("processing") === "in_progress");
ok("status: expired -> cancelled", coerceReportStatus("expired") === "cancelled");
ok("status: failed -> error", coerceReportStatus("failed") === "error");
ok("status: unknown -> pending (safe)", coerceReportStatus("who_knows") === "pending");
ok("status: null -> pending", coerceReportStatus(null) === "pending");

// --- normalizeRecommendation ------------------------------------------------
ok("rec: approved -> approve", normalizeRecommendation("approved") === "approve");
ok("rec: conditional -> review", normalizeRecommendation("conditional") === "review");
ok("rec: high_risk -> decline", normalizeRecommendation("high_risk") === "decline");
ok("rec: blank -> unknown (never auto-approve)", normalizeRecommendation("") === "unknown");

// --- applicationStatusForReport ---------------------------------------------
ok("report pending -> app screening", applicationStatusForReport("pending") === "screening");
ok("report in_progress -> app screening", applicationStatusForReport("in_progress") === "screening");
ok("report complete -> app complete", applicationStatusForReport("complete") === "complete");
ok("report cancelled -> app declined", applicationStatusForReport("cancelled") === "declined");
ok("report error -> no app status", applicationStatusForReport("error") === null);

// --- nextApplicationStatus (composes with the Slice-1 status machine) -------
ok("submitted + in_progress -> screening", nextApplicationStatus("submitted", "in_progress") === "screening");
ok("screening + complete -> complete", nextApplicationStatus("screening", "complete") === "complete");
ok("screening + cancelled -> declined", nextApplicationStatus("screening", "cancelled") === "declined");
ok("screening + in_progress -> null (no-op, already screening)", nextApplicationStatus("screening", "in_progress") === null);
ok("complete + late webhook -> null (cannot regress)", nextApplicationStatus("complete", "in_progress") === null);
ok("submitted + complete -> null (illegal skip of screening)", nextApplicationStatus("submitted", "complete") === null);
ok("any + error -> null", nextApplicationStatus("screening", "error") === null);

// --- isValidHandshake -------------------------------------------------------
ok("handshake match", isValidHandshake("s3cr3t-token", "s3cr3t-token"));
ok("handshake mismatch", !isValidHandshake("s3cr3t-token", "wrong-tokennnn"));
ok("handshake length mismatch", !isValidHandshake("abc", "abcd"));
ok("handshake empty expected", !isValidHandshake("", "abc"));
ok("handshake empty provided", !isValidHandshake("abc", ""));

// --- parseReportCompleteWebhook ---------------------------------------------
const wh = parseReportCompleteWebhook({
  purchase_token: "pt_123",
  status: "completed",
  recommendation: "approve",
  score_band: "Good",
  report_url: "https://sandbox.singlekey.com/report/pt_123",
  completed_at: "2026-07-11T12:00:00Z",
});
ok("webhook parses purchase token", wh?.purchaseToken === "pt_123");
ok("webhook parses status", wh?.status === "complete");
ok("webhook parses recommendation", wh?.recommendation === "approve");
ok("webhook parses score band", wh?.scoreBand === "Good");
ok("webhook parses report url", wh?.reportUrl === "https://sandbox.singlekey.com/report/pt_123");
ok("webhook sets completedAt when complete", wh?.completedAt === "2026-07-11T12:00:00Z");
ok("webhook with no token -> null", parseReportCompleteWebhook({ status: "completed" }) === null);
ok("webhook non-object -> null", parseReportCompleteWebhook("nope") === null);
const whPending = parseReportCompleteWebhook({ purchaseToken: "pt_9", status: "processing" });
ok("webhook camelCase token + pending clears completedAt", whPending?.purchaseToken === "pt_9" && whPending?.completedAt === null);

// --- singlekey adapter: dark by default, pure normalizer --------------------
ok("singlekey NOT configured without env token", singleKeyConfigured() === false);
const skReport = normalizeSingleKeyReport({ purchase_token: "pt_x", status: "ready", decision: "reject" });
ok("normalizeSingleKeyReport maps ready->complete", skReport?.status === "complete");
ok("normalizeSingleKeyReport maps reject->decline", skReport?.recommendation === "decline");
ok("normalizeSingleKeyReport null on no token", normalizeSingleKeyReport({ status: "ready" }) === null);

// --- Summary ----------------------------------------------------------------
console.log(`\nrental-screening: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);

// Unit tests for the pure incident-reports domain model.
// Run: npx tsx scripts/test-incident-reports.ts
import {
  INCIDENT_CATEGORIES,
  INCIDENT_CATEGORY_LABELS,
  isIncidentCategory,
  incidentCategoryLabel,
  INCIDENT_REPORT_STATUSES,
  isIncidentReportStatus,
  incidentReportStatusLabel,
  isOpenReportStatus,
  canApproveReport,
  canDeclineReport,
  reportAcceptsMedia,
  generateReportToken,
  MAX_DESCRIPTION_LEN,
  MIN_DESCRIPTION_LEN,
  validateReportSubmission,
  reportErrorMessage,
  deriveReporterDefaults,
  tenantReportPath,
  tenantReportUrl,
} from "../lib/incident-reports";
import { WORK_ORDER_CATEGORIES } from "../lib/work-orders";

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

// --- Category whitelist -----------------------------------------------------
ok("9 incident categories", INCIDENT_CATEGORIES.length === 9);
ok(
  "incident categories EXACTLY match work_orders categories",
  INCIDENT_CATEGORIES.length === WORK_ORDER_CATEGORIES.length &&
    INCIDENT_CATEGORIES.every((c) =>
      (WORK_ORDER_CATEGORIES as readonly string[]).includes(c),
    ),
);
ok("every category has a label", INCIDENT_CATEGORIES.every((c) => !!INCIDENT_CATEGORY_LABELS[c]));
ok("isIncidentCategory plumbing", isIncidentCategory("plumbing"));
ok("isIncidentCategory rejects junk", !isIncidentCategory("explosion"));
ok("isIncidentCategory rejects non-string", !isIncidentCategory(5));
ok("isIncidentCategory rejects null", !isIncidentCategory(null));
ok("label known category", incidentCategoryLabel("hvac") === "Heating / cooling");
ok("label unknown passes through", incidentCategoryLabel("mystery") === "mystery");

// --- Status machine ---------------------------------------------------------
ok("5 statuses", INCIDENT_REPORT_STATUSES.length === 5);
ok("isIncidentReportStatus submitted", isIncidentReportStatus("submitted"));
ok("isIncidentReportStatus rejects open", !isIncidentReportStatus("open"));
ok("submitted is open", isOpenReportStatus("submitted"));
ok("under_review is open", isOpenReportStatus("under_review"));
ok("approved is NOT open", !isOpenReportStatus("approved"));
ok("converted is NOT open", !isOpenReportStatus("converted"));
ok("declined is NOT open", !isOpenReportStatus("declined"));
ok("can approve submitted", canApproveReport("submitted"));
ok("can approve under_review", canApproveReport("under_review"));
ok("cannot approve converted", !canApproveReport("converted"));
ok("cannot approve declined", !canApproveReport("declined"));
ok("can decline submitted", canDeclineReport("submitted"));
ok("cannot decline converted", !canDeclineReport("converted"));
ok("accepts media while submitted", reportAcceptsMedia("submitted"));
ok("rejects media once converted", !reportAcceptsMedia("converted"));
ok("rejects media once declined", !reportAcceptsMedia("declined"));
ok("status label submitted->New", incidentReportStatusLabel("submitted") === "New");
ok("status label converted", /work order/i.test(incidentReportStatusLabel("converted")));

// --- Token ------------------------------------------------------------------
const t1 = generateReportToken();
const t2 = generateReportToken();
ok("token is url-safe (no +/=)", /^[A-Za-z0-9_-]+$/.test(t1));
ok("token ~32 chars (24 bytes base64url)", t1.length >= 30 && t1.length <= 34);
ok("tokens are unique", t1 !== t2);

// --- Submission validation --------------------------------------------------
ok("valid submission", validateReportSubmission({ category: "plumbing", description: "Leak under sink" }).ok === true);
const v = validateReportSubmission({ category: "plumbing", description: "  Leak under sink  " });
ok("valid submission trims description", v.ok === true && v.description === "Leak under sink");
ok("valid submission returns typed category", v.ok === true && v.category === "plumbing");
ok(
  "rejects bad category",
  (() => {
    const r = validateReportSubmission({ category: "boom", description: "x".repeat(10) });
    return !r.ok && r.reason === "bad_category";
  })(),
);
ok(
  "rejects missing category",
  (() => {
    const r = validateReportSubmission({ category: null, description: "x".repeat(10) });
    return !r.ok && r.reason === "bad_category";
  })(),
);
ok(
  "rejects empty description",
  (() => {
    const r = validateReportSubmission({ category: "general", description: "   " });
    return !r.ok && r.reason === "description_required";
  })(),
);
ok(
  "rejects too-short description",
  (() => {
    const r = validateReportSubmission({ category: "general", description: "x".repeat(MIN_DESCRIPTION_LEN - 1) });
    return !r.ok && r.reason === "description_required";
  })(),
);
ok(
  "accepts min-length description",
  validateReportSubmission({ category: "general", description: "x".repeat(MIN_DESCRIPTION_LEN) }).ok === true,
);
ok(
  "rejects too-long description",
  (() => {
    const r = validateReportSubmission({ category: "general", description: "x".repeat(MAX_DESCRIPTION_LEN + 1) });
    return !r.ok && r.reason === "description_too_long";
  })(),
);
ok(
  "accepts max-length description",
  validateReportSubmission({ category: "general", description: "x".repeat(MAX_DESCRIPTION_LEN) }).ok === true,
);

// --- Error copy -------------------------------------------------------------
ok("error copy bad_category", /about/i.test(reportErrorMessage("bad_category")));
ok("error copy description_required", /describe/i.test(reportErrorMessage("description_required")));
ok("error copy not_found", /link/i.test(reportErrorMessage("not_found")));
ok("error copy closed", /handled/i.test(reportErrorMessage("closed")));
ok("error copy default", reportErrorMessage(undefined) === reportErrorMessage("failed"));

// --- Reporter defaults ------------------------------------------------------
ok(
  "empty tenants -> nulls",
  (() => {
    const d = deriveReporterDefaults([]);
    return d.name === null && d.contact === null;
  })(),
);
ok(
  "picks primary tenant",
  (() => {
    const d = deriveReporterDefaults([
      { name: "Co Tenant", email: "co@x.com", phone: null, is_primary: false },
      { name: "Primary T", email: "p@x.com", phone: null, is_primary: true },
    ]);
    return d.name === "Primary T" && d.contact === "p@x.com";
  })(),
);
ok(
  "prefers email over phone for contact",
  (() => {
    const d = deriveReporterDefaults([{ name: "A", email: "a@x.com", phone: "555", is_primary: true }]);
    return d.contact === "a@x.com";
  })(),
);
ok(
  "falls back to phone when no email",
  (() => {
    const d = deriveReporterDefaults([{ name: "A", email: null, phone: "555-1212", is_primary: true }]);
    return d.contact === "555-1212";
  })(),
);
ok(
  "skips identity-less primary for a usable tenant",
  (() => {
    const d = deriveReporterDefaults([
      { name: null, email: null, phone: null, is_primary: true },
      { name: "Usable", email: "u@x.com", phone: null, is_primary: false },
    ]);
    return d.name === "Usable" && d.contact === "u@x.com";
  })(),
);
ok(
  "trims whitespace name/contact",
  (() => {
    const d = deriveReporterDefaults([{ name: "  Spacey  ", email: "  s@x.com ", phone: null, is_primary: true }]);
    return d.name === "Spacey" && d.contact === "s@x.com";
  })(),
);

// --- Link builders ----------------------------------------------------------
ok("tenantReportPath", tenantReportPath("abc123") === "/report/abc123");
ok("tenantReportPath encodes", tenantReportPath("a/b") === "/report/a%2Fb");
ok("tenantReportUrl joins", tenantReportUrl("https://app.vacantless.com", "tok") === "https://app.vacantless.com/report/tok");
ok("tenantReportUrl strips trailing slash", tenantReportUrl("https://app.vacantless.com/", "tok") === "https://app.vacantless.com/report/tok");

console.log(`\nincident-reports: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// Unit tests for the rental-application capture domain model (Slice 1, S453).
// Run: npx tsx scripts/test-rental-application.ts
import {
  canTransition,
  isTerminalStatus,
  normalizePayMode,
  sanitizeFormData,
  validateSubmission,
  applicationPersonCandidate,
  RENTAL_APPLICATION_STATUSES,
} from "../lib/rental-application";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("rental-application: capture domain model");

// --- Status machine ---------------------------------------------------------
ok("requested -> submitted allowed", canTransition("requested", "submitted"));
ok("requested -> declined allowed (withdraw)", canTransition("requested", "declined"));
ok("submitted -> screening allowed", canTransition("submitted", "screening"));
ok("screening -> complete allowed", canTransition("screening", "complete"));
ok("screening -> declined allowed", canTransition("screening", "declined"));
ok("requested -> screening NOT allowed (skips submit)", !canTransition("requested", "screening"));
ok("requested -> complete NOT allowed", !canTransition("requested", "complete"));
ok("submitted -> requested NOT allowed (no going back)", !canTransition("submitted", "requested"));
ok("complete -> anything NOT allowed", !canTransition("complete", "declined"));
ok("complete is terminal", isTerminalStatus("complete"));
ok("declined is terminal", isTerminalStatus("declined"));
ok("requested is not terminal", !isTerminalStatus("requested"));
ok("five statuses defined", RENTAL_APPLICATION_STATUSES.length === 5);

// --- Pay mode ---------------------------------------------------------------
ok("pay mode landlord kept", normalizePayMode("landlord") === "landlord");
ok("pay mode applicant kept", normalizePayMode("applicant") === "applicant");
ok("pay mode default = applicant (null)", normalizePayMode(null) === "applicant");
ok("pay mode default = applicant (garbage)", normalizePayMode("free") === "applicant");

// --- sanitizeFormData: the never-persist-PII guardrail ----------------------
const s = sanitizeFormData({
  employer: "Acme",
  gross_income: "6500",
  occupants: [{ name: "A", age: 30 }],
  sin: "123-456-789",
  DOB: "1990-01-01",
  driver_licence: "X1234",
  income_docs: "base64…",
  random_extra: "nope",
});
ok("keeps allowed field employer", s.data.employer === "Acme");
ok("keeps allowed field gross_income", s.data.gross_income === "6500");
ok("keeps allowed array occupants", Array.isArray(s.data.occupants));
ok("drops SIN (sensitive)", !("sin" in s.data));
ok("drops DOB (case-insensitive sensitive)", !("dob" in s.data) && !("DOB" in s.data));
ok("drops driver_licence (sensitive)", !("driver_licence" in s.data));
ok("drops income_docs (sensitive)", !("income_docs" in s.data));
ok("reports dropped sensitive keys", s.droppedSensitive.includes("sin") && s.droppedSensitive.includes("dob"));
ok("drops unknown field", !("random_extra" in s.data));
ok("reports unknown dropped", s.droppedUnknown.includes("random_extra"));

const sEmpty = sanitizeFormData(null);
ok("null form data -> empty", Object.keys(sEmpty.data).length === 0);
const sArr = sanitizeFormData([1, 2, 3]);
ok("array form data -> empty (not an object map)", Object.keys(sArr.data).length === 0);

// --- validateSubmission -----------------------------------------------------
ok(
  "valid submission passes",
  validateSubmission({ consent: true, applicant_name: "Jane", applicant_email: "j@x.com" }).ok,
);
ok(
  "no consent fails",
  validateSubmission({ consent: false, applicant_name: "Jane", applicant_email: "j@x.com" })
    .errors.includes("consent_required"),
);
ok(
  "no name fails",
  validateSubmission({ consent: true, applicant_name: "  ", applicant_email: "j@x.com" })
    .errors.includes("name_required"),
);
ok(
  "no contact fails",
  validateSubmission({ consent: true, applicant_name: "Jane" }).errors.includes("contact_required"),
);
ok(
  "phone-only contact passes",
  validateSubmission({ consent: true, applicant_name: "Jane", applicant_phone: "+15195551212" }).ok,
);

// --- applicationPersonCandidate ---------------------------------------------
const cand = applicationPersonCandidate({
  applicant_email: "  Jane@Example.COM ",
  applicant_phone_e164: "+15195551212",
});
ok("candidate email normalized", cand.email_norm === "jane@example.com");
ok("candidate phone passed through", cand.phone_e164 === "+15195551212");
const candNoEmail = applicationPersonCandidate({ applicant_email: "", applicant_phone_e164: "+1519" });
ok("candidate blank email -> null", candNoEmail.email_norm === null);

// --- Summary ----------------------------------------------------------------
console.log(`\nrental-application: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);

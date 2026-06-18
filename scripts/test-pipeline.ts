// Unit tests for the pure pipeline label/description/outcome helpers.
// Run: npx tsx scripts/test-pipeline.ts
import {
  PIPELINE_STAGES,
  statusLabel,
  statusDescription,
  isLeadStatus,
  needsReply,
  SHOWING_OUTCOMES,
  showingOutcomeLabel,
  isShowingOutcome,
} from "../lib/pipeline";

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

// --- stages ----------------------------------------------------------------
ok("8 pipeline stages", PIPELINE_STAGES.length === 8);
ok("isLeadStatus: new", isLeadStatus("new"));
ok("isLeadStatus: rejects junk", !isLeadStatus("pending"));

ok(
  "every stage has a non-empty label",
  PIPELINE_STAGES.every((s) => statusLabel(s).length > 0),
);
ok(
  "every stage has a non-empty description",
  PIPELINE_STAGES.every((s) => statusDescription(s).length > 0),
);
ok("statusLabel: unknown falls back to input", statusLabel("zzz") === "zzz");
ok("statusDescription: unknown -> empty", statusDescription("zzz") === "");

// The QA fix: Replied and Contacted must read as clearly different things.
ok(
  "replied vs contacted descriptions differ",
  statusDescription("replied") !== statusDescription("contacted"),
);
ok(
  "replied mentions a first/automatic response",
  /first|automatic/i.test(statusDescription("replied")),
);
ok(
  "contacted mentions connecting",
  /connect/i.test(statusDescription("contacted")),
);

// --- needsReply (dashboard "Needs reply" cue) ------------------------------
ok("needsReply: new -> true", needsReply("new") === true);
ok(
  "needsReply: every non-new stage -> false",
  PIPELINE_STAGES.filter((s) => s !== "new").every((s) => needsReply(s) === false),
);
ok("needsReply: junk -> false", needsReply("zzz") === false);

// --- outcomes --------------------------------------------------------------
ok("4 showing outcomes", SHOWING_OUTCOMES.length === 4);
ok("isShowingOutcome: attended", isShowingOutcome("attended"));
ok("isShowingOutcome: rejects junk", !isShowingOutcome("done"));
ok("outcome label: no_show -> No-show", showingOutcomeLabel("no_show") === "No-show");
ok(
  "every outcome has a label",
  SHOWING_OUTCOMES.every((o) => showingOutcomeLabel(o).length > 0),
);

// --- house style: no em/en dashes in any operator-facing copy --------------
const allCopy = [
  ...PIPELINE_STAGES.map((s) => statusLabel(s)),
  ...PIPELINE_STAGES.map((s) => statusDescription(s)),
  ...SHOWING_OUTCOMES.map((o) => showingOutcomeLabel(o)),
].join(" ");
ok("no em/en dashes in pipeline copy", !/[—–]/.test(allCopy));

// ---------------------------------------------------------------------------
console.log(`\npipeline: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

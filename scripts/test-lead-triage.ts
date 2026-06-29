// Unit tests for the pure lead triage classifier.
// Run: npx tsx scripts/test-lead-triage.ts
import {
  triageLead,
  TRIAGE_BUCKET_ORDER,
  TRIAGE_BUCKET_LABEL,
  type TriageInput,
} from "../lib/lead-triage";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const base: TriageInput = {
  status: "contacted",
  followUp: "none",
  qualifiedOut: false,
};

// Bucketing.
{
  ok("new -> needs_you", triageLead({ ...base, status: "new" }).bucket === "needs_you");
  ok(
    "overdue follow-up -> needs_you",
    triageLead({ ...base, status: "contacted", followUp: "overdue" }).bucket ===
      "needs_you",
  );
  ok(
    "today follow-up -> needs_you",
    triageLead({ ...base, status: "booked", followUp: "today" }).bucket ===
      "needs_you",
  );
  ok(
    "open + no follow-up -> in_progress",
    triageLead({ ...base, status: "contacted", followUp: "none" }).bucket ===
      "in_progress",
  );
  ok(
    "upcoming follow-up -> in_progress (not pressing)",
    triageLead({ ...base, status: "showed", followUp: "upcoming" }).bucket ===
      "in_progress",
  );
  ok("leased -> closed", triageLead({ ...base, status: "leased" }).bucket === "closed");
  ok("lost -> closed", triageLead({ ...base, status: "lost" }).bucket === "closed");
}

// Terminal beats a stale follow-up date.
{
  ok(
    "leased with overdue follow-up still closed",
    triageLead({ status: "leased", followUp: "overdue", qualifiedOut: false })
      .bucket === "closed",
  );
}

// Reasons only on needs_you.
{
  ok(
    "new reason",
    triageLead({ ...base, status: "new" }).reason === "Needs a reply",
  );
  ok(
    "overdue reason",
    triageLead({ ...base, status: "contacted", followUp: "overdue" }).reason ===
      "Follow-up overdue",
  );
  ok(
    "today reason",
    triageLead({ ...base, status: "contacted", followUp: "today" }).reason ===
      "Follow-up due today",
  );
  ok(
    "in_progress has no reason",
    triageLead({ ...base, status: "contacted" }).reason === null,
  );
  ok("closed has no reason", triageLead({ ...base, status: "lost" }).reason === null);
}

// Urgency ordering within needs_you: new < overdue < today.
{
  const rNew = triageLead({ ...base, status: "new" }).rank;
  const rOverdue = triageLead({ ...base, status: "contacted", followUp: "overdue" }).rank;
  const rToday = triageLead({ ...base, status: "contacted", followUp: "today" }).rank;
  ok("new most urgent", rNew < rOverdue && rOverdue < rToday);
}

// Cross-bucket ordering: needs_you < in_progress < closed.
{
  const need = triageLead({ ...base, status: "new" }).rank;
  const work = triageLead({ ...base, status: "contacted" }).rank;
  const closed = triageLead({ ...base, status: "leased" }).rank;
  ok("needs_you before in_progress before closed", need < work && work < closed);
}

// "Working" sub-order: applied hotter than replied.
{
  const applied = triageLead({ ...base, status: "applied" }).rank;
  const replied = triageLead({ ...base, status: "replied" }).rank;
  ok("applied ranks above replied", applied < replied);
}

// Metadata sanity.
{
  ok("bucket order has 3", TRIAGE_BUCKET_ORDER.length === 3);
  ok(
    "every bucket has a label",
    TRIAGE_BUCKET_ORDER.every((b) => TRIAGE_BUCKET_LABEL[b].length > 0),
  );
}

console.log(`\nlead-triage: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

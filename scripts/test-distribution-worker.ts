// Unit tests for the pure done-for-you posting worker helpers (S553 Slice 1).
// Run: npx tsx scripts/test-distribution-worker.ts
import { readFileSync } from "fs";
import {
  WORKER_ELIGIBLE_STATUSES,
  WORKER_GATE_STATUSES,
  TAKEDOWN_TRANSPORT,
  isWorkerGate,
  workerJobEligible,
  selectGate,
  standingSpendAuthorized,
  workerAccountConnected,
  assertWorkerNeverTerminal,
  buildAgentComposePrompt,
} from "../lib/distribution-worker";
import { ATTEMPT_ACTOR_TYPES } from "../lib/distribution-attempts";
import { buildRunSteps } from "../lib/distribution-run";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- eligibility -----------------------------------------------------------
const base = {
  mode: "concierge" as const,
  transport: "concierge",
  publishStatus: "queued" as const,
  automationAuthorized: true,
  claimedBy: null as string | null,
};

ok("queued concierge authorized unclaimed IS eligible", workerJobEligible(base));
ok(
  "queued is an eligible status",
  (WORKER_ELIGIBLE_STATUSES as readonly string[]).includes("queued"),
);
ok(
  "eligible set is exactly [queued] (gates await a human, never re-prepared)",
  WORKER_ELIGIBLE_STATUSES.length === 1 && WORKER_ELIGIBLE_STATUSES[0] === "queued",
);
ok(
  "unauthorized channel is NOT eligible",
  !workerJobEligible({ ...base, automationAuthorized: false }),
);
ok(
  "already-claimed is NOT eligible",
  !workerJobEligible({ ...base, claimedBy: "someone" }),
);
ok(
  "non-concierge mode is NOT eligible",
  !workerJobEligible({ ...base, mode: "browser_copilot" as never }),
);
ok(
  "take-down transport is NOT eligible for the publish worker",
  !workerJobEligible({ ...base, transport: TAKEDOWN_TRANSPORT }),
);
for (const s of ["needs_operator", "needs_login", "needs_payment", "submitting", "live", "blocked"]) {
  ok(
    `non-queued status ${s} is NOT eligible (no re-processing / no touching automatic)`,
    !workerJobEligible({ ...base, publishStatus: s as never }),
  );
}

// --- S702w: an authorized robot site counts as connected ------------------
ok("connected account is connected", workerAccountConnected({ channel: "facebook_feed", accountStatus: "connected", automationAuthorized: false }));
ok("Rentals.ca needs_setup + authorized -> connected", workerAccountConnected({ channel: "rentals_ca", accountStatus: "needs_setup", automationAuthorized: true }));
ok("Zumper needs_setup + authorized -> connected", workerAccountConnected({ channel: "zumper", accountStatus: "needs_setup", automationAuthorized: true }));
ok("Rentals.ca not authorized -> not connected", !workerAccountConnected({ channel: "rentals_ca", accountStatus: "needs_setup", automationAuthorized: false }));
ok("non-robot site needs connected status", !workerAccountConnected({ channel: "facebook", accountStatus: "needs_setup", automationAuthorized: true }));
ok(
  "Agile Rentals.ca gates at needs_operator, not needs_login",
  selectGate({
    requiresLogin: true,
    connected: workerAccountConnected({ channel: "rentals_ca", accountStatus: "needs_setup", automationAuthorized: true }),
    channelRequiresPayment: false,
    paymentCleared: false,
  }) === "needs_operator",
);
{
  const routeSrc0 = readFileSync("app/api/cron/distribution-worker/route.ts", "utf8");
  ok("route gates on workerAccountConnected", routeSrc0.includes("connected: workerAccountConnected({"));
}

// --- gate precedence -------------------------------------------------------
ok(
  "login gate wins when login required + not connected",
  selectGate({
    requiresLogin: true,
    connected: false,
    channelRequiresPayment: true,
    paymentCleared: false,
  }) === "needs_login",
);
ok(
  "login satisfied (connected) falls through to payment",
  selectGate({
    requiresLogin: true,
    connected: true,
    channelRequiresPayment: true,
    paymentCleared: false,
  }) === "needs_payment",
);
ok(
  "payment gate when paid + not cleared (no login needed)",
  selectGate({
    requiresLogin: false,
    connected: false,
    channelRequiresPayment: true,
    paymentCleared: false,
  }) === "needs_payment",
);
ok(
  "payment cleared falls through to operator",
  selectGate({
    requiresLogin: false,
    connected: false,
    channelRequiresPayment: true,
    paymentCleared: true,
  }) === "needs_operator",
);
ok(
  "no login + no payment => needs_operator (ready for final submit)",
  selectGate({
    requiresLogin: false,
    connected: false,
    channelRequiresPayment: false,
    paymentCleared: false,
  }) === "needs_operator",
);

// --- output states are exactly the three gates -----------------------------
ok(
  "gate set is exactly needs_login | needs_payment | needs_operator",
  WORKER_GATE_STATUSES.length === 3 &&
    isWorkerGate("needs_login") &&
    isWorkerGate("needs_payment") &&
    isWorkerGate("needs_operator"),
);
for (const g of WORKER_GATE_STATUSES) ok(`gate ${g} is a WorkerGate`, isWorkerGate(g));
for (const bad of ["live", "submitted", "queued", "skipped", "rejected"]) {
  ok(`${bad} is NOT a worker gate`, !isWorkerGate(bad));
}

// selectGate can only ever return a gate, never a terminal state.
const gateOutputs = new Set<string>();
for (const requiresLogin of [true, false])
  for (const connected of [true, false])
    for (const channelRequiresPayment of [true, false])
      for (const paymentCleared of [true, false])
        gateOutputs.add(
          selectGate({ requiresLogin, connected, channelRequiresPayment, paymentCleared }),
        );
ok(
  "selectGate output universe ⊆ {needs_login, needs_payment, needs_operator}",
  [...gateOutputs].every((s) => isWorkerGate(s)),
);

// --- terminal guard --------------------------------------------------------
for (const t of ["live", "submitted", "skipped", "rejected"]) {
  let threw = false;
  try {
    assertWorkerNeverTerminal(t);
  } catch {
    threw = true;
  }
  ok(`assertWorkerNeverTerminal throws on ${t}`, threw);
}
for (const g of WORKER_GATE_STATUSES) {
  let threw = false;
  try {
    assertWorkerNeverTerminal(g);
  } catch {
    threw = true;
  }
  ok(`assertWorkerNeverTerminal allows gate ${g}`, !threw);
}

// --- agent actor -----------------------------------------------------------
ok("'agent' actor is registered", (ATTEMPT_ACTOR_TYPES as readonly string[]).includes("agent"));

// --- prompt has no env/secrets --------------------------------------------
const prompt = buildAgentComposePrompt({
  channelKey: "kijiji",
  channelLabel: "Kijiji",
  listing: {
    propertyAddress: "833 Pillette Rd, Unit 20",
    beds: 1,
    baths: 1,
    rentCents: 129900,
    unitType: null,
    description: "Bright one bedroom.",
  },
  steps: buildRunSteps("kijiji"),
});
const promptBlob = `${prompt.system}\n${prompt.user}`;
ok("prompt mentions the channel label", promptBlob.includes("Kijiji"));
ok("prompt forbids submit/publish", /never .*submit|never .*publish/i.test(prompt.system));
ok(
  "prompt contains NO env/secret material",
  !/process\.env|ANTHROPIC_API_KEY|CRON_SECRET|x-api-key|sk-ant/i.test(promptBlob),
);
ok("prompt omits unsupplied facts (no unit type line)", !/Unit type:/i.test(promptBlob));

// --- source assertions: the worker never writes live/submitted/external_url --
{
  const routeSrc = readFileSync("app/api/cron/distribution-worker/route.ts", "utf8");
  ok(
    "route never writes publish_status live",
    !/publish_status:\s*["']live["']/.test(routeSrc),
  );
  ok(
    "route never writes publish_status submitted",
    !/publish_status:\s*["']submitted["']/.test(routeSrc),
  );
  ok("route never writes external_url", !/external_url:/.test(routeSrc));
  ok("route is dark-gated by DISTRIBUTION_WORKER_ENABLED", routeSrc.includes("DISTRIBUTION_WORKER_ENABLED"));
  ok("route gates on automation_authorized", routeSrc.includes("automation_authorized"));
  ok(
    "route excludes take-down transport in the candidate query",
    routeSrc.includes("transport.is.null,transport.neq.takedown"),
  );
  ok(
    "route threads candidate transport into workerJobEligible",
    routeSrc.includes("transport: c.transport"),
  );
  ok("route records actorType agent", routeSrc.includes('actorType: "agent"'));
  ok("route calls assertWorkerNeverTerminal before the gate write", routeSrc.includes("assertWorkerNeverTerminal"));
  ok("route treats attempt insert failure as a safe skip", routeSrc.includes("attempt_log_failed"));
  ok("route links prepared item to the agent attempt", routeSrc.includes("last_attempt_id: attemptRow.id"));
}
{
  const aiSrc = readFileSync("lib/distribution-worker-ai.ts", "utf8");
  ok("ai adapter is dark on missing key", aiSrc.includes('skipped: "no_key"'));
  ok("ai adapter never throws (has catch)", aiSrc.includes("catch"));
}

// S708: a standing spend limit sends a paid item to the robot (needs_operator);
// without one it parks at needs_payment as before.
ok("spend limit set -> paid item goes to the robot", selectGate({ requiresLogin: true, connected: true, channelRequiresPayment: true, paymentCleared: standingSpendAuthorized({ spend_authorized: true, spend_revoked_at: null, spend_max_cents: 3384 }) }) === "needs_operator");
ok("no spend limit -> needs_payment", selectGate({ requiresLogin: true, connected: true, channelRequiresPayment: true, paymentCleared: standingSpendAuthorized({ spend_authorized: false, spend_revoked_at: null, spend_max_cents: 3384 }) }) === "needs_payment");
ok("revoked spend -> not authorized", standingSpendAuthorized({ spend_authorized: true, spend_revoked_at: "2026-10-11T00:00:00Z", spend_max_cents: 3384 }) === false);
ok("zero ceiling -> not authorized", standingSpendAuthorized({ spend_authorized: true, spend_revoked_at: null, spend_max_cents: 0 }) === false);
ok("missing account -> not authorized", standingSpendAuthorized(null) === false);

console.log(`\ndistribution-worker: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// Unit tests for the concierge "Publish for me" eligibility rule (S474b).
// Run: npx tsx scripts/test-distribution-concierge.ts
import {
  canRequestConcierge,
  CONCIERGE_ELIGIBLE_STATUSES,
  PUBLISH_STATUSES,
  type PublishMode,
} from "../lib/distribution-publish";

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) pass++;
  else {
    fail++;
    console.error("FAIL:", msg);
  }
}

const HUMAN_MODES: PublishMode[] = [
  "browser_copilot",
  "feed_partner",
  "broker",
  "custom",
];

// Eligible statuses + a human mode => can request concierge.
for (const mode of HUMAN_MODES) {
  for (const s of CONCIERGE_ELIGIBLE_STATUSES) {
    ok(canRequestConcierge(s, mode) === true, `${s}/${mode} should be eligible`);
  }
}

// Automatic mode is NEVER eligible (the app posts it itself).
for (const s of PUBLISH_STATUSES) {
  ok(
    canRequestConcierge(s, "automatic") === false,
    `automatic/${s} must not be eligible`,
  );
}

// Already-concierge is NEVER eligible (already requested).
for (const s of PUBLISH_STATUSES) {
  ok(
    canRequestConcierge(s, "concierge") === false,
    `concierge/${s} must not be eligible`,
  );
}

// Non-human-action statuses are not eligible even for human modes.
const ineligible = PUBLISH_STATUSES.filter(
  (s) => !CONCIERGE_ELIGIBLE_STATUSES.includes(s),
);
for (const mode of HUMAN_MODES) {
  for (const s of ineligible) {
    ok(
      canRequestConcierge(s, mode) === false,
      `${s}/${mode} should NOT be eligible`,
    );
  }
}

console.log(`test-distribution-concierge: ${pass}/${fail}`);
if (fail > 0) process.exit(1);

// Unit tests for lib/concierge-stale-close (S697g): when a publish request may
// close by itself, and what the closing note says.
// Run: npx tsx scripts/test-concierge-stale-close.ts
import {
  STALE_CLOSE_PUBLISH_STATUS,
  STALE_CLOSE_ROW_STATUS,
  STALE_CLOSE_TRIGGERS,
  isStaleCloseTrigger,
  shouldStaleCloseItem,
  staleCloseAudit,
  type StaleCloseTrigger,
} from "../lib/concierge-stale-close";
import {
  CONCIERGE_OPEN_STATUSES,
  PUBLISH_STATUSES,
  isPublishStatus,
  isResolvedPublishStatus,
} from "../lib/distribution-publish";
import { TAKEDOWN_TRANSPORT } from "../lib/distribution-worker";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
    if (extra !== undefined) console.error("    ->", JSON.stringify(extra));
  }
}

const concierge = (publishStatus: string, transport: string | null = null) => ({
  publishStatus: publishStatus as never,
  transport,
  mode: "concierge",
});

// --- the landing status is one the schema and the UI already know ------------
ok(
  "closes into an existing publish status",
  isPublishStatus(STALE_CLOSE_PUBLISH_STATUS),
  STALE_CLOSE_PUBLISH_STATUS,
);
ok(
  "the landing status counts as settled, so the desk stops showing it",
  isResolvedPublishStatus(STALE_CLOSE_PUBLISH_STATUS),
);
ok(
  "the landing status is not itself an open status (no self-reopening loop)",
  !CONCIERGE_OPEN_STATUSES.includes(STALE_CLOSE_PUBLISH_STATUS),
);
ok("the row status is a legal run-item status", STALE_CLOSE_ROW_STATUS === "skipped");

// --- every open status is closeable -----------------------------------------
for (const status of CONCIERGE_OPEN_STATUSES) {
  ok(`open status ${status} can close on its own`, shouldStaleCloseItem(concierge(status)));
}

// --- nothing settled reopens -------------------------------------------------
for (const status of PUBLISH_STATUSES) {
  if (CONCIERGE_OPEN_STATUSES.includes(status)) continue;
  ok(
    `settled status ${status} is left alone`,
    !shouldStaleCloseItem(concierge(status)),
  );
}

// --- takedown work survives a lease-up --------------------------------------
ok(
  "a takedown item is never auto-closed (the ad still has to come down)",
  !shouldStaleCloseItem(concierge("queued", TAKEDOWN_TRANSPORT)),
);
ok(
  "a non-takedown transport still closes",
  shouldStaleCloseItem(concierge("queued", "browser_copilot")),
);

// --- only concierge items --------------------------------------------------
ok(
  "an automatic item is not the desk's to close",
  !shouldStaleCloseItem({ publishStatus: "queued" as never, transport: null, mode: "automatic" }),
);
ok(
  "a null mode is not the desk's to close",
  !shouldStaleCloseItem({ publishStatus: "queued" as never, transport: null, mode: null }),
);
ok(
  "a null publish status is left alone",
  !shouldStaleCloseItem({ publishStatus: null, transport: null, mode: "concierge" }),
);

// --- the note names the reason and the site ---------------------------------
const auditCases: Array<[StaleCloseTrigger, string]> = [
  ["leased", "leased"],
  ["off_market", "off market"],
  ["archived", "archived"],
  ["already_live", "already live"],
];
for (const [trigger, phrase] of auditCases) {
  const note = staleCloseAudit(trigger, "Kijiji");
  ok(`${trigger} note says why`, note.includes(phrase), note);
  ok(`${trigger} note names the site`, note.includes("Kijiji"), note);
  ok(`${trigger} note is one short sentence`, note.length <= 100, note.length);
  ok(`${trigger} note has no em dash`, !note.includes("—"), note);
}

// --- trigger guard ----------------------------------------------------------
for (const t of STALE_CLOSE_TRIGGERS) ok(`${t} is a known trigger`, isStaleCloseTrigger(t));
ok("an unknown trigger is rejected", !isStaleCloseTrigger("expired"));
ok("a non-string trigger is rejected", !isStaleCloseTrigger(null));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

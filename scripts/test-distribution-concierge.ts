// Unit tests for the concierge "Publish for me" eligibility rule (S474b).
// Run: npx tsx scripts/test-distribution-concierge.ts
import { readFileSync } from "fs";
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

function sourceBlock(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  return source.slice(startIndex, endIndex === -1 ? source.length : endIndex);
}

// S666 duplicate-post guard: a captured but unconfirmed live URL must not look
// like a never-submitted item.
const conciergeActionsSrc = readFileSync(
  "app/dashboard/admin/concierge-actions.ts",
  "utf8",
);
const approveBlock = sourceBlock(
  conciergeActionsSrc,
  "export async function approveConciergeSubmit",
  "export async function clearConciergeExternalUrl",
);
ok(
  approveBlock.includes('.is("operator_submit_approved_at", null)') &&
    approveBlock.includes('.is("external_url", null)'),
  "desk approve requires no prior approval and no captured external_url",
);
ok(
  approveBlock.includes('.not("external_url", "is", null)') &&
    approveBlock.includes('redirect(`${DESK}?err=already_posted`)'),
  "desk approve reports already_posted when an unconfirmed live ad exists",
);
ok(
  approveBlock.includes('redirect(`${DESK}?err=stale`)'),
  "desk approve keeps stale redirect for genuinely stale rows",
);

const clearBlock = sourceBlock(
  conciergeActionsSrc,
  "export async function clearConciergeExternalUrl",
  "// Staff couldn't post it",
);
ok(
  clearBlock.includes("external_url: null") &&
    clearBlock.includes("external_posted_at: null"),
  "clear captured URL action removes the URL before a future approve",
);
ok(
  clearBlock.includes('.eq("publish_status", "needs_operator")') &&
    clearBlock.includes('.is("operator_submit_approved_at", null)') &&
    clearBlock.includes('.not("external_url", "is", null)'),
  "clear captured URL is limited to unapproved needs_operator items with a URL",
);

const propertyActionsSrc = readFileSync(
  "app/dashboard/properties/distribution-actions.ts",
  "utf8",
);
const authorizeBlock = sourceBlock(
  propertyActionsSrc,
  "export async function authorizeAutopilotSubmit",
  "export async function setRelistRadarStandingAutoRefresh",
);
ok(
  authorizeBlock.includes('.in("publish_status", ["needs_operator", "needs_payment"])') &&
    authorizeBlock.includes('.select("spend_authorized, spend_max_cents, spend_revoked_at")') &&
    authorizeBlock.includes('backTo(propertyId, "autopilot_spend_auth"'),
  "property approve preflights needs_payment items against standing spend authorization",
);
ok(
  authorizeBlock.includes('.eq("publish_status", pendingItem.publish_status)') &&
    authorizeBlock.includes('.is("external_url", null)'),
  "property approve updates the exact pending status while requiring no captured URL",
);
ok(
  authorizeBlock.includes('.not("external_url", "is", null)') &&
    authorizeBlock.includes('backTo(propertyId, "already_posted")'),
  "property approve redirects already_posted when a captured live URL exists",
);
ok(
  authorizeBlock.includes('backTo(propertyId, "autopilot_stale")'),
  "property approve keeps autopilot_stale for genuinely stale rows",
);
ok(
  /\.is\("operator_submit_approved_at", null\)[\s\S]*?\.not\("external_url", "is", null\)/.test(
    approveBlock,
  ) &&
    /\.is\("operator_submit_approved_at", null\)[\s\S]*?\.not\("external_url", "is", null\)/.test(
      authorizeBlock,
    ),
  "already_posted classification only applies after approval was cleared, preserving approved stale-worker reclaim cases",
);

const deskSrc = readFileSync("app/dashboard/admin/concierge/page.tsx", "utf8");
const approveChoiceStart = deskSrc.indexOf("item.operator_submit_approved_at ?");
const capturedBranchIndex = deskSrc.indexOf("hasCapturedUnconfirmedAd ? (", approveChoiceStart);
const regularApproveIndex = deskSrc.indexOf("prep.reachedForm", approveChoiceStart);
ok(
  capturedBranchIndex > approveChoiceStart &&
    capturedBranchIndex < regularApproveIndex,
  "desk renders posted-awaiting-confirmation branch before Approve & submit",
);
ok(
  deskSrc.includes("Posted, awaiting confirmation") &&
    deskSrc.includes("postedAwaitingConfirmationCount"),
  "desk surfaces posted-awaiting-confirmation items as a distinct signal",
);
ok(
  deskSrc.includes("href={item.external_url}") &&
    deskSrc.includes("Open captured ad"),
  "desk links to the captured live ad",
);
ok(
  deskSrc.includes("action={clearConciergeExternalUrl}") &&
    deskSrc.includes("This ad is gone - clear it"),
  "desk clear action is separate from re-approval",
);
ok(
  deskSrc.includes("Mark captured ad live"),
  "desk makes Mark live the primary action for captured ads",
);
ok(
  deskSrc.includes('searchParams?.err === "already_posted"') &&
    deskSrc.includes("Confirm it or take it down before submitting again."),
  "desk shows an already_posted instruction",
);

const propertyPageSrc = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
ok(
  propertyPageSrc.includes('searchParams.dist === "already_posted"') &&
    propertyPageSrc.includes("Already posted, awaiting confirmation."),
  "property page shows an already_posted notice",
);

console.log(`test-distribution-concierge: ${pass}/${fail}`);
if (fail > 0) process.exit(1);

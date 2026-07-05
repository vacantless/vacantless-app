// Unit tests for the pure distribution-partner helpers.
// Run: npx tsx scripts/test-distribution-partner.ts
import {
  PARTNER_STATUSES,
  partnerStatusLabel,
  isPartnerStatus,
  normalizePartnerStatus,
  partnerStatusTone,
  isPartnerActive,
  partnerNextStep,
} from "../lib/distribution-partner";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

ok("5 partner statuses", PARTNER_STATUSES.length === 5);
ok("label accepted", partnerStatusLabel("accepted") === "Accepted");
ok("label junk -> Not started", partnerStatusLabel("???") === "Not started");
ok("isPartnerStatus true", isPartnerStatus("submitted"));
ok("isPartnerStatus false", !isPartnerStatus("nope"));
ok("normalize junk -> not_started", normalizePartnerStatus("x") === "not_started");

ok("tone accepted positive", partnerStatusTone("accepted") === "positive");
ok("tone rejected danger", partnerStatusTone("rejected") === "danger");
ok("tone submitted warning", partnerStatusTone("submitted") === "warning");
ok("tone not_started neutral", partnerStatusTone("not_started") === "neutral");

ok("isPartnerActive only for accepted", isPartnerActive("accepted"));
ok("isPartnerActive false for submitted", !isPartnerActive("submitted"));
ok("isPartnerActive false for junk", !isPartnerActive("???"));

ok(
  "nextStep not_started asks to inquire",
  /ingest your listing feed/.test(partnerNextStep({ status: "not_started", hasFeedUrl: false })),
);
ok(
  "nextStep submitted + no url nudges for url",
  /add the feed URL/.test(partnerNextStep({ status: "submitted", hasFeedUrl: false })),
);
ok(
  "nextStep submitted + url says waiting",
  /waiting on the channel/.test(partnerNextStep({ status: "submitted", hasFeedUrl: true })),
);
ok(
  "nextStep accepted confirms carrying",
  /carrying your feed/.test(partnerNextStep({ status: "accepted", hasFeedUrl: true })),
);
ok(
  "nextStep rejected says resubmit",
  /resubmit/.test(partnerNextStep({ status: "rejected", hasFeedUrl: false })),
);
ok(
  "no em dashes in next steps",
  !/[—–]/.test(
    PARTNER_STATUSES.map((s) =>
      partnerNextStep({ status: s, hasFeedUrl: true }) +
      partnerNextStep({ status: s, hasFeedUrl: false }),
    ).join(" "),
  ),
);

console.log(`\ndistribution-partner: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

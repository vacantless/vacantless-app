// Unit tests for rental delete/archive guard logic.
// Run: npx tsx scripts/test-property-archive.ts

import {
  archivePropertyStatusUpdate,
  hardDeletable,
  unarchivePropertyStatusUpdate,
} from "../lib/property-archive";
import type { PropertyStatus } from "../lib/listing-state";
import { readFileSync } from "fs";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

ok("bare draft is hard deletable", hardDeletable("draft", 0, 0, 0));
ok("bare off-market is hard deletable", hardDeletable("off_market", 0, 0, 0));
ok("available is never hard deletable", !hardDeletable("available", 0, 0, 0));
ok("paused is never hard deletable", !hardDeletable("paused", 0, 0, 0));
ok("leased is never hard deletable", !hardDeletable("leased", 0, 0, 0));
ok("draft with a lead is not hard deletable", !hardDeletable("draft", 1, 0, 0));
ok(
  "draft with a tenancy is not hard deletable",
  !hardDeletable("draft", 0, 1, 0),
);
ok(
  "draft with a listing post is not hard deletable",
  !hardDeletable("draft", 0, 0, 1),
);
ok(
  "off-market with any history is not hard deletable",
  !hardDeletable("off_market", 1, 1, 1),
);

const listingStateSource = readFileSync("lib/listing-state.ts", "utf8");
const listingFeedSource = readFileSync("lib/listing-feed.ts", "utf8");
const tenancyActionsSource = readFileSync(
  "app/dashboard/tenancies/actions.ts",
  "utf8",
);

ok(
  // Migration 0223 (S672): off-market now LOADS and renders the "no longer
  // available" page with the org's open units, so a link already shared for an
  // archived unit keeps working. Only a draft still 404s.
  "public /r visibility hides draft and ONLY draft",
  /return status !== "draft";\n\}/.test(listingStateSource),
);
ok(
  "public /r visibility no longer hides off-market",
  !/status !== "draft" && status !== "off_market"/.test(listingStateSource),
);
ok(
  "the off-market help string no longer promises a not-found page",
  !/off_market: "Retired\. The public link returns not-found\."/.test(
    listingStateSource,
  ),
);
ok(
  "feed still only lists available rentals",
  /export const FEED_LISTABLE_STATUS = "available" as const;/.test(
    listingFeedSource,
  ),
);
ok(
  "tenancy status path still leaves off-market alone",
  /\.in\("status", \["available", "paused"\]\)/.test(tenancyActionsSource),
);
ok(
  "private-unit creation still writes off-market directly",
  /status: "off_market"/.test(tenancyActionsSource),
);
ok(
  "tenancy paths do not write archive restore state",
  !/status_before_archive/.test(tenancyActionsSource),
);

const archivedAt = "2026-08-17T12:00:00.000Z";

function roundTripStatus(start: PropertyStatus): {
  archive: ReturnType<typeof archivePropertyStatusUpdate>;
  restore: ReturnType<typeof unarchivePropertyStatusUpdate>;
  finalStatus: PropertyStatus;
} {
  const archive = archivePropertyStatusUpdate(start, archivedAt);
  const archivedStatus = archive.status ?? start;
  const restore = unarchivePropertyStatusUpdate({
    status: archivedStatus,
    status_before_archive: archive.status_before_archive,
  });
  return {
    archive,
    restore,
    finalStatus: restore.status ?? archivedStatus,
  };
}

const availableRoundTrip = roundTripStatus("available");
ok(
  "archive available: flips to off-market",
  availableRoundTrip.archive.status === "off_market",
);
ok(
  "archive available: records prior status",
  availableRoundTrip.archive.status_before_archive === "available",
);
ok(
  "restore available: restores available",
  availableRoundTrip.finalStatus === "available",
);
ok(
  "restore available: clears recorded status",
  availableRoundTrip.restore.status_before_archive === null,
);

const pausedRoundTrip = roundTripStatus("paused");
ok(
  "archive paused: flips to off-market",
  pausedRoundTrip.archive.status === "off_market",
);
ok(
  "archive paused: records prior status",
  pausedRoundTrip.archive.status_before_archive === "paused",
);
ok("restore paused: restores paused", pausedRoundTrip.finalStatus === "paused");
ok(
  "restore paused: clears recorded status",
  pausedRoundTrip.restore.status_before_archive === null,
);

const offMarketRoundTrip = roundTripStatus("off_market");
ok(
  "archive off-market: does not record prior status",
  offMarketRoundTrip.archive.status_before_archive === null,
);
ok(
  "archive off-market: leaves status unchanged",
  offMarketRoundTrip.archive.status === undefined,
);
ok(
  "restore off-market: stays off-market",
  offMarketRoundTrip.finalStatus === "off_market",
);

const leasedRoundTrip = roundTripStatus("leased");
ok(
  "archive leased: does not record prior status",
  leasedRoundTrip.archive.status_before_archive === null,
);
ok(
  "archive leased: leaves status unchanged",
  leasedRoundTrip.archive.status === undefined,
);
ok("restore leased: stays leased", leasedRoundTrip.finalStatus === "leased");

const operatorChangedRestore = unarchivePropertyStatusUpdate({
  status: "leased",
  status_before_archive: "available",
});
ok(
  "restore operator-changed archived row: leaves changed status alone",
  operatorChangedRestore.status === undefined,
);
ok(
  "restore operator-changed archived row: clears recorded status",
  operatorChangedRestore.status_before_archive === null,
);

console.log(`property-archive: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// ============================================================================
// Read-only takedown contract verifier for the S279 headless-first reset.
//
// Run from vacantless-app:
//   node scripts/verify-takedown-contracts.mjs
//
// This checks app + sibling worker source only. It does not read or mutate DB
// rows, call Graph/Kijiji, run Playwright, send email, or remove an ad.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = process.cwd();
const workerRoot = process.env.VACANTLESS_WORKER_ROOT
  ? resolve(process.env.VACANTLESS_WORKER_ROOT)
  : resolve(appRoot, "../vacantless-worker");

let passed = 0;
const failures = [];

function pass(name) {
  passed++;
  console.log(`PASS ${name}`);
}

function fail(name, detail) {
  const message = detail == null ? "failed" : String(detail);
  failures.push(`${name}: ${message}`);
  console.error(`FAIL ${name}: ${message}`);
}

function ok(name, condition, detail) {
  if (condition) pass(name);
  else fail(name, detail);
}

function readApp(path) {
  return readFileSync(resolve(appRoot, path), "utf8");
}

function readWorker(path) {
  return readFileSync(resolve(workerRoot, path), "utf8");
}

function objectBlock(source, key) {
  const marker = `${key}: {`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const end = source.indexOf("\n  },", start + marker.length);
  return source.slice(start, end > start ? end : undefined);
}

function appChecks() {
  const contracts = readApp("lib/distribution-channel-contracts.ts");
  const leaseup = readApp("lib/leaseup-takedown.ts");
  const notifications = readApp("lib/notifications.ts");
  const workerConstants = readApp("lib/distribution-worker.ts");

  const facebookFeed = objectBlock(contracts, "facebook_feed");
  const facebookMarketplace = objectBlock(contracts, "facebook");
  const kijiji = objectBlock(contracts, "kijiji");
  const rentfaster = objectBlock(contracts, "rentfaster");
  const viewit = objectBlock(contracts, "viewit");
  const realtor = objectBlock(contracts, "realtor_ca");

  ok(
    "app contract exposes Facebook Page feed as the only API delete portal",
    facebookFeed.includes('takedownKind: "api_delete"') &&
      facebookFeed.includes('proofKind: "graph_permalink"') &&
      !facebookMarketplace.includes('takedownKind: "api_delete"'),
  );
  ok(
    "app keeps Facebook Marketplace as operator removal fallback",
    facebookMarketplace.includes('executionKind: "fallback"') &&
      facebookMarketplace.includes('takedownKind: "operator_task"'),
  );
  ok(
    "app keeps Kijiji lease-up takedown as operator task until queue contract exists",
    kijiji.includes('executionKind: "headless_worker"') &&
      kijiji.includes('takedownKind: "operator_task"'),
  );
  ok(
    "app keeps paid browser portals as operator removal tasks",
    rentfaster.includes('takedownKind: "operator_task"') &&
      viewit.includes('takedownKind: "operator_task"'),
  );
  ok(
    "app keeps Realtor.ca removal on the broker route",
    realtor.includes('takedownKind: "broker_request"'),
  );
  ok(
    "keep-live action requires setup before behind-the-scenes removal",
    contracts.includes('contract.takedownKind === "api_delete"') &&
      contracts.includes('contract.takedownKind === "headless_delete"') &&
      contracts.includes("setupActionForKeepLive(contract, account"),
  );
  ok(
    "app uses takedown transport so publish worker will not claim removal rows",
    workerConstants.includes('export const TAKEDOWN_TRANSPORT = "takedown"') &&
      leaseup.includes("transport: TAKEDOWN_TRANSPORT"),
  );
  ok(
    "app queues automated lease-up removal only for connected authorized Facebook Page feed",
    leaseup.includes("post.portal === FB_PAGE_FEED") &&
      leaseup.includes("automationAuthorized") &&
      leaseup.includes('account?.account_status === "connected"'),
  );
  ok(
    "app sends takedown-needed notification only for operator task branch",
    leaseup.includes('eventKey: "leasing.distribution_takedown_needed"') &&
      leaseup.includes("!args.automatedDelete") &&
      notifications.includes('key: "leasing.distribution_takedown_needed"'),
  );
}

function workerChecks() {
  const sweep = readWorker("src/takedown-sweep.ts");
  const leaseup = readWorker("src/takedown-leaseup.ts");
  const graph = readWorker("src/facebook-graph.ts");
  const tracker = readWorker("src/tracker.ts");
  const kijijiDelete = readWorker("src/takedown-kijiji.ts");
  const kijijiSubmit = readWorker("src/phase-b-submit.ts");
  const smoke = readWorker("artifacts/smoke-takedown-sweep.ts");

  ok(
    "worker lease-up sweep is scoped to facebook_feed takedown rows",
    sweep.includes('export const TAKEDOWN_CHANNEL = "facebook_feed"') &&
      sweep.includes("row.transport === TAKEDOWN_TRANSPORT") &&
      sweep.includes("row.publish_status === TAKEDOWN_QUEUED_STATUS") &&
      sweep.includes("row.channel === TAKEDOWN_CHANNEL"),
  );
  ok(
    "worker takedown claim is guarded by item, channel, mode, transport, queued, and unclaimed",
    sweep.includes('.eq("id", itemId)') &&
      sweep.includes('.eq("channel", TAKEDOWN_CHANNEL)') &&
      sweep.includes('.eq("mode", TAKEDOWN_MODE)') &&
      sweep.includes('.eq("transport", TAKEDOWN_TRANSPORT)') &&
      sweep.includes('.eq("publish_status", TAKEDOWN_QUEUED_STATUS)') &&
      sweep.includes('.is("concierge_claimed_by", null)'),
  );
  ok(
    "worker lease-up delete requires Graph delete plus object-gone proof",
    leaseup.includes("deletePageFeedPost") &&
      leaseup.includes("postReturns404") &&
      leaseup.includes("Graph DELETE for") &&
      leaseup.includes("GET proving the Graph object is gone"),
  );
  ok(
    "worker routes unproven Graph removal back to operator",
    leaseup.includes("delete_not_confirmed_gone") &&
      leaseup.includes("Graph API did not prove removal") &&
      leaseup.includes("operator must remove manually"),
  );
  ok(
    "worker marks listing_posts removed only through markTakenDown proof path",
    leaseup.includes("markTakenDown(admin") &&
      tracker.includes('.update({ status: "removed" })') &&
      tracker.includes('.eq("status", "live")') &&
      tracker.includes('result: "removed"'),
  );
  ok(
    "Graph gone predicate accepts raw 404 and deleted-object error shapes",
    graph.includes("res.status === 404") &&
      graph.includes("graphErrorMeansObjectGone") &&
      graph.includes("error.code === 100") &&
      graph.includes("error.code === 10"),
  );
  ok(
    "worker smoke test proves sweep excludes Kijiji lease-up takedown",
    smoke.includes('id: "kijiji"') &&
      smoke.includes('channel: "kijiji"') &&
      smoke.includes("eligible.length === 1"),
  );
  ok(
    "Kijiji delete exists only in the Relist Radar free refresh path for now",
    kijijiDelete.includes("deleteKijijiAdFromMyAds") &&
      kijijiSubmit.includes("runRelistRadarDelete") &&
      kijijiSubmit.includes("isRelistRadarFreeRefreshJob") &&
      kijijiSubmit.includes("relist_radar_autorefresh"),
  );
}

function main() {
  appChecks();
  workerChecks();
  console.log(
    JSON.stringify(
      {
        passed,
        failed: failures.length,
        failures,
        workerRoot,
      },
      null,
      2,
    ),
  );
  if (failures.length > 0) process.exit(1);
}

main();

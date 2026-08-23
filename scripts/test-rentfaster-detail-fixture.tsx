// Render/unit fixture for the unblocked Get online RentFaster detail path.
// Run: npx tsx scripts/test-rentfaster-detail-fixture.tsx
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ChannelPublishRail,
  buildChannelPublishRailBuckets,
  type ChannelPublishAccountRow,
} from "../app/dashboard/properties/[id]/channel-publish-rail";
import {
  DISTRIBUTION_CHANNELS,
  channelByKey,
  getOnlineAssistKindForChannel,
} from "../lib/distribution-channels";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

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

function row(
  channel: string,
  overrides: Partial<ChannelPublishAccountRow> = {},
): ChannelPublishAccountRow {
  return {
    channel,
    accountStatus: null,
    transport: null,
    automationAuthorized: false,
    hasFeedRoute: false,
    ...overrides,
  };
}

const rentfaster = channelByKey("rentfaster");
ok("RentFaster exists in the channel registry", Boolean(rentfaster));
ok("RentFaster remains planned in Settings", rentfaster?.integrationStatus === "planned");
ok(
  "RentFaster is explicitly promoted to paid assist in Get online",
  rentfaster ? getOnlineAssistKindForChannel(rentfaster) === "paid_posting_assist" : false,
);

const buckets = buildChannelPublishRailBuckets({
  channels: DISTRIBUTION_CHANNELS,
  accountRows: [
    // A stray Viewit row must not accidentally turn every paid planned channel
    // into a posting-assist path. RentFaster is the explicit exception.
    row("viewit", { accountStatus: "connected" }),
  ],
  linkIsLive: true,
  liveChannelKeys: [],
});

const rentfasterRailRow = buckets.oneTap.find((item) => item.key === "rentfaster");
ok("unblocked rail puts RentFaster in one-tap", Boolean(rentfasterRailRow));
ok("unblocked RentFaster row is not in top-up/setup", !buckets.gated.some((item) => item.key === "rentfaster"));
ok("RentFaster chip asks for payment", rentfasterRailRow?.chip.label === "Needs payment");
ok("RentFaster chip remains a warning", rentfasterRailRow?.chip.tone === "warning");
ok("RentFaster does not count live before proof", rentfasterRailRow?.reachesRenters === false);
ok("RentFaster is not live before proof", rentfasterRailRow?.live === false);
ok(
  "RentFaster headline names fee approval and proof",
  (rentfasterRailRow?.headline ?? "").includes("approve any fee") &&
    (rentfasterRailRow?.headline ?? "").includes("save the real live URL"),
);
ok(
  "RentFaster direct portal URL stays the add-listing page",
  rentfasterRailRow?.portalUrl === "https://www.rentfaster.ca/admin/add-listing/",
);
ok("Viewit stays gated despite being paid", buckets.gated.some((item) => item.key === "viewit"));

const html = renderToStaticMarkup(
  React.createElement(ChannelPublishRail, { buckets }),
);

ok("rendered rail has the paid/proof bucket title", html.includes("Needs sign-in, payment, or proof"));
ok("rendered rail includes RentFaster label", html.includes("RentFaster.ca"));
ok("rendered rail includes Needs payment chip", html.includes("Needs payment"));
ok(
  "rendered rail includes fee approval/proof copy",
  html.includes("Vacantless prepares the RentFaster post; you approve any fee and save the real live URL."),
);
ok(
  "rendered rail exposes direct RentFaster portal affordance",
  html.includes("Open RentFaster.ca directly") &&
    html.includes("https://www.rentfaster.ca/admin/add-listing/"),
);
ok(
  "rendered rail keeps live/payment/proof honesty",
  html.includes("Nothing is posted, paid, or marked Live without approval and proof."),
);
ok("rendered unlocked fixture is not the one-listing blocked state", !html.includes("Waiting on one listing"));
ok("rendered unlocked fixture does not ask for property type", !html.includes("Add property type"));

const distributeTabSource = readFileSync(
  "app/dashboard/properties/[id]/distribute-tab.tsx",
  "utf8",
);
ok(
  "DistributeTab withholds the posting rail only while packetBlocked",
  distributeTabSource.includes("{!packetBlocked && (") &&
    distributeTabSource.includes("<ChannelPublishRail"),
);

console.log(`\nrentfaster-detail-fixture: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

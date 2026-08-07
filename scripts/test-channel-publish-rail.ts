// Pure tests for the Simple Get-online three-tier channel rail.
// Run: npx tsx scripts/test-channel-publish-rail.ts
import {
  buildChannelPublishRailBuckets,
  type ChannelPublishAccountRow,
} from "../app/dashboard/properties/[id]/channel-publish-rail";
import { DISTRIBUTION_CHANNELS } from "../lib/distribution-channels";

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

function eq<T>(name: string, actual: T, expected: T) {
  ok(`${name}: expected ${String(expected)}, got ${String(actual)}`, actual === expected);
}

function keys(rows: { key: string }[]) {
  return rows.map((row) => row.key);
}

function has(rows: { key: string }[], key: string) {
  return keys(rows).includes(key);
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

function buckets(opts: {
  accounts?: ChannelPublishAccountRow[];
  linkIsLive?: boolean;
  liveKeys?: string[];
  instagramEnabled?: boolean;
} = {}) {
  return buildChannelPublishRailBuckets({
    channels: DISTRIBUTION_CHANNELS,
    accountRows: opts.accounts ?? [],
    linkIsLive: opts.linkIsLive ?? false,
    liveChannelKeys: opts.liveKeys ?? [],
    instagramEnabled: opts.instagramEnabled,
  });
}

{
  const b = buckets();
  eq("default instant only has synthetic rows", keys(b.instant).join("|"), "vacantless_page|email_alerts");
  ok("facebook marketplace is one-tap, not instant", has(b.oneTap, "facebook"));
  ok("kijiji live assisted-manual is one-tap", has(b.oneTap, "kijiji"));
  ok("rentals.ca without accepted feed is one-tap", has(b.oneTap, "rentals_ca"));
  ok("zumper without accepted feed is one-tap", has(b.oneTap, "zumper"));
  ok("rentfaster planned route is gated", has(b.gated, "rentfaster"));
  ok("facebook page pre-connect is gated", has(b.gated, "facebook_feed"));
  ok("instagram is gated by default", has(b.gated, "instagram"));
  ok("realtor.ca stays gated", has(b.gated, "realtor_ca"));
  eq("real row count includes two synthetic rows", b.totalCount, DISTRIBUTION_CHANNELS.length + 2);
}

{
  const b = buckets({ linkIsLive: true });
  eq("live renter page + email alert count", b.liveCount, 2);
  ok("synthetic live rows are instant", b.instant.slice(0, 2).every((item) => item.live));
}

{
  const b = buckets({
    linkIsLive: true,
    liveKeys: ["facebook_feed"],
    accounts: [
      row("facebook_feed", {
        accountStatus: "connected",
        automationAuthorized: true,
      }),
    ],
  });
  ok("authorized facebook page graduates to instant", has(b.instant, "facebook_feed"));
  eq("authorized live facebook page adds to live count", b.liveCount, 3);
}

{
  const b = buckets({
    accounts: [
      row("facebook_feed", {
        accountStatus: "connected",
        automationAuthorized: false,
      }),
    ],
  });
  ok("connected but unauthorized facebook page stays gated", has(b.gated, "facebook_feed"));
}

{
  const b = buckets({
    accounts: [row("rentals_ca", { accountStatus: "accepted", hasFeedRoute: true })],
  });
  ok("accepted rentals.ca feed graduates to instant", has(b.instant, "rentals_ca"));
  ok("zumper without accepted feed remains one-tap", has(b.oneTap, "zumper"));
}

{
  const disabled = buckets({
    linkIsLive: true,
    liveKeys: ["instagram"],
    accounts: [
      row("instagram", {
        accountStatus: "connected",
        automationAuthorized: true,
      }),
    ],
  });
  ok("instagram stays gated while disabled", has(disabled.gated, "instagram"));
  eq("disabled instagram is not counted live", disabled.liveCount, 2);

  const enabled = buckets({
    linkIsLive: true,
    liveKeys: ["instagram"],
    instagramEnabled: true,
    accounts: [
      row("instagram", {
        accountStatus: "connected",
        automationAuthorized: true,
      }),
    ],
  });
  ok("enabled authorized instagram can graduate to instant", has(enabled.instant, "instagram"));
  eq("enabled live instagram counts only when explicit", enabled.liveCount, 3);
}

console.log(`\nchannel-publish-rail: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

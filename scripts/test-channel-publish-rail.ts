// Pure tests for the Simple Get-online three-tier channel rail.
// Run: npx tsx scripts/test-channel-publish-rail.ts
import { readFileSync } from "node:fs";
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
    spendAuthorized: false,
    spendMaxCents: null,
    spendRevokedAt: null,
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
  ok("facebook marketplace is fallback, not instant", has(b.oneTap, "facebook"));
  eq(
    "facebook marketplace chip reads Fallback task, not Coming soon",
    b.oneTap.find((r) => r.key === "facebook")?.chip.label ?? "",
    "Fallback task",
  );
  ok("kijiji needs account setup by default", has(b.gated, "kijiji"));
  eq(
    "kijiji reads Needs account",
    b.gated.find((r) => r.key === "kijiji")?.chip.label ?? "",
    "Needs account",
  );
  ok(
    "kijiji rail shows expiry and removal lifecycle",
    (b.gated.find((r) => r.key === "kijiji")?.lifecycleSummary ?? "").includes(
      "Auto-refresh before 60 days",
    ) &&
      (b.gated.find((r) => r.key === "kijiji")?.lifecycleSummary ?? "").includes(
        "removal task",
      ),
  );
  ok("rentals.ca without account is setup-gated", has(b.gated, "rentals_ca"));
  eq(
    "rentals.ca without account reads Needs account",
    b.gated.find((r) => r.key === "rentals_ca")?.chip.label ?? "",
    "Needs account",
  );
  ok("zumper without account is setup-gated", has(b.gated, "zumper"));
  eq(
    "zumper without account reads Needs account",
    b.gated.find((r) => r.key === "zumper")?.chip.label ?? "",
    "Needs account",
  );
  ok("rentfaster paid channel needs account first", has(b.gated, "rentfaster"));
  eq(
    "rentfaster reads Needs account, not Coming soon",
    b.gated.find((r) => r.key === "rentfaster")?.chip.label ?? "",
    "Needs account",
  );
  ok(
    "rentfaster paid setup keeps spend honest",
    (b.gated.find((r) => r.key === "rentfaster")?.headline ?? "").includes(
      "Connect",
    ),
  );
  ok("viewit paid route remains gated", has(b.gated, "viewit"));
  ok("facebook page pre-connect is gated", has(b.gated, "facebook_feed"));
  ok("instagram is gated by default", has(b.gated, "instagram"));
  ok("realtor.ca stays gated", has(b.gated, "realtor_ca"));
  ok("kijiji exposes direct portal URL", /^https:\/\//.test(b.gated.find((r) => r.key === "kijiji")?.portalUrl ?? ""));
  ok("synthetic renter page has no direct portal URL", b.instant.find((r) => r.key === "vacantless_page")?.portalUrl == null);
  eq("real row count includes two synthetic rows", b.totalCount, DISTRIBUTION_CHANNELS.length + 2);
}

{
  const b = buckets({ linkIsLive: true });
  eq("live renter page + email alert count", b.liveCount, 2);
  eq("live renter page + email are not outside reach", b.externalLiveCount, 0);
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
  const facebook = b.instant.find((r) => r.key === "facebook_feed");
  ok("authorized facebook page graduates to instant", has(b.instant, "facebook_feed"));
  eq("authorized facebook page can be revoked", facebook?.automationAction ?? null, "revoke");
  ok(
    "authorized facebook page copy keeps approval in the loop",
    (facebook?.headline ?? "").includes("publish and approve"),
  );
  eq("authorized live facebook page adds to live count", b.liveCount, 3);
  eq("authorized live facebook page adds to outside reach", b.externalLiveCount, 1);
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
  const facebook = b.gated.find((r) => r.key === "facebook_feed");
  ok("connected but unauthorized facebook page stays gated", has(b.gated, "facebook_feed"));
  eq(
    "connected but unauthorized facebook page chip asks for authorization",
    facebook?.chip.label ?? "",
    "Needs authorization",
  );
  eq(
    "connected but unauthorized facebook page exposes authorize action",
    facebook?.automationAction ?? null,
    "authorize",
  );
  ok(
    "connected but unauthorized facebook page does not ask to connect",
    !(facebook?.headline ?? "").includes("Link Facebook Page feed"),
  );
  ok(
    "connected but unauthorized facebook page copy states consent plainly",
    (facebook?.headline ?? "").includes("when you publish"),
  );
}

{
  const b = buckets({
    accounts: [
      row("kijiji", {
        accountStatus: "connected",
        automationAuthorized: true,
        spendAuthorized: true,
        spendMaxCents: 5000,
      }),
    ],
  });
  const kijiji = b.instant.find((r) => r.key === "kijiji");
  ok("connected funded Kijiji graduates to ready launch", has(b.instant, "kijiji"));
  eq("Kijiji ready chip", kijiji?.chip.label ?? "", "Ready");
}

{
  const b = buckets({
    accounts: [
      row("rentfaster", {
        accountStatus: "connected",
        automationAuthorized: true,
      }),
    ],
  });
  const rentfaster = b.gated.find((r) => r.key === "rentfaster");
  ok("RentFaster connected without spend needs limit", has(b.gated, "rentfaster"));
  eq("RentFaster spend chip", rentfaster?.chip.label ?? "", "Needs spend limit");
}

{
  const b = buckets({
    accounts: [
      row("rentals_ca", {
        accountStatus: "connected",
        automationAuthorized: true,
      }),
    ],
  });
  ok("connected rentals.ca account graduates to ready launch", has(b.instant, "rentals_ca"));
  ok("zumper without account remains setup-gated", has(b.gated, "zumper"));
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
  eq("disabled instagram is not outside reach", disabled.externalLiveCount, 0);

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
  eq("enabled live instagram counts as outside reach", enabled.externalLiveCount, 1);
}

{
  const b = buckets({
    instagramEnabled: true,
    accounts: [
      row("instagram", {
        accountStatus: "connected",
        automationAuthorized: false,
      }),
    ],
  });
  const instagram = b.gated.find((r) => r.key === "instagram");
  ok("connected but unauthorized instagram stays gated", has(b.gated, "instagram"));
  eq(
    "connected but unauthorized instagram chip asks for authorization",
    instagram?.chip.label ?? "",
    "Needs authorization",
  );
  eq(
    "connected but unauthorized instagram exposes authorize action",
    instagram?.automationAction ?? null,
    "authorize",
  );
  ok(
    "connected but unauthorized instagram does not ask to connect",
    !(instagram?.headline ?? "").includes("Link Instagram"),
  );
}

const publishEverywhereSource = readFileSync(
  "app/dashboard/properties/[id]/publish-everywhere.tsx",
  "utf8",
);
ok(
  "Publish Everywhere renders channel authorization consent copy",
  publishEverywhereSource.includes(
    "Authorize Vacantless to post this listing to this account",
  ),
);
ok(
  "Publish Everywhere can revoke channel automation",
  publishEverywhereSource.includes("revokeChannelAutomation"),
);

const channelPublishRailSource = readFileSync(
  "app/dashboard/properties/[id]/channel-publish-rail.tsx",
  "utf8",
);
ok(
  "posting rail launch title names account and spend setup",
  channelPublishRailSource.includes("Account and spend setup"),
);
ok(
  "paid channels keep spend limit copy",
  channelPublishRailSource.includes("pass-through spend limit"),
);
ok(
  "direct portal copy does not imply silent automation",
  !channelPublishRailSource.includes("prefer not to use the automated path") &&
    channelPublishRailSource.includes(
      "needs native controls, sign-in, payment",
    ),
);
ok(
  "rail renders lifecycle summary below the readiness headline",
  channelPublishRailSource.includes("lifecycleSummary") &&
    channelPublishRailSource.includes("Follows the renter page") &&
    channelPublishRailSource.includes("turns off when the rental is leased or paused"),
);

console.log(`\nchannel-publish-rail: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

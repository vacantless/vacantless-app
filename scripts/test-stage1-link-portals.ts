// Pure tests for the S583 Stage 1 "Link your portals" grouping and copy keys.
// Run: npx tsx scripts/test-stage1-link-portals.ts
import type { ChannelTileStatusRow } from "../lib/distribution-channel-tile-statuses";
import {
  canRenderStage1Connect,
  groupStage1ChannelRows,
  stage1ConnectButtonKey,
  stage1ConnectHref,
  stage1StatusCopy,
} from "../lib/stage1-link-portals";

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

function eq(name: string, actual: unknown, expected: unknown) {
  ok(name, actual === expected);
  if (actual !== expected) {
    console.error(`    expected: ${String(expected)}`);
    console.error(`    actual:   ${String(actual)}`);
  }
}

const row = (
  channel: string,
  state: ChannelTileStatusRow["state"],
  canConnect: boolean,
): ChannelTileStatusRow => ({
  channel,
  state,
  headline: `${channel} fallback headline that UI must not render`,
  canConnect,
});

const rows: ChannelTileStatusRow[] = [
  row("facebook_feed", "linked", false),
  row("instagram", "not_linked", true),
  row("facebook", "not_available_yet", false),
  row("realtor_ca", "mls_only", false),
  row("kijiji", "not_linked", true),
];

const groups = groupStage1ChannelRows(rows);

eq("three groups are returned", groups.length, 3);
eq("ready group is first", groups[0].id, "ready");
eq("coming group is second", groups[1].id, "coming");
eq("agent group is third", groups[2].id, "agent");
eq("ready group uses catalog key", groups[0].titleKey, "groupReady");
eq("coming group uses catalog key", groups[1].titleKey, "groupComing");
eq("agent group uses catalog key", groups[2].titleKey, "groupAgent");
eq(
  "ready group contains linked + not_linked rows in input order",
  groups[0].rows.map((r) => r.channel).join("|"),
  "facebook_feed|instagram|kijiji",
);
eq(
  "coming group contains not_available_yet rows",
  groups[1].rows.map((r) => r.channel).join("|"),
  "facebook",
);
eq(
  "agent group contains mls_only rows",
  groups[2].rows.map((r) => r.channel).join("|"),
  "realtor_ca",
);

eq("linked title key", stage1StatusCopy("linked").titleKey, "status.linked");
eq("linked sub key", stage1StatusCopy("linked").subKey, "status.linkedSub");
eq("linked tone", stage1StatusCopy("linked").tone, "success");
eq(
  "not_linked title key",
  stage1StatusCopy("not_linked").titleKey,
  "status.notLinked",
);
eq(
  "not_linked sub key",
  stage1StatusCopy("not_linked").subKey,
  "status.notLinkedSub",
);
eq("not_linked tone", stage1StatusCopy("not_linked").tone, "attention");
eq(
  "not_available_yet title key",
  stage1StatusCopy("not_available_yet").titleKey,
  "status.notAvailable",
);
eq(
  "not_available_yet sub key",
  stage1StatusCopy("not_available_yet").subKey,
  "status.notAvailableSub",
);
eq("not_available_yet tone", stage1StatusCopy("not_available_yet").tone, "neutral");
eq("mls_only title key", stage1StatusCopy("mls_only").titleKey, "status.mlsOnly");
eq("mls_only sub key", stage1StatusCopy("mls_only").subKey, "status.mlsOnlySub");
eq("mls_only tone", stage1StatusCopy("mls_only").tone, "info");

ok(
  "canConnect true + not_linked + oauth shows a button",
  canRenderStage1Connect(row("instagram", "not_linked", true), "oauth"),
);
ok(
  "canConnect true + not_linked + account_login shows a button",
  canRenderStage1Connect(row("kijiji", "not_linked", true), "account_login"),
);
ok(
  "canConnect false hides not_linked button",
  !canRenderStage1Connect(row("kijiji", "not_linked", false), "account_login"),
);
ok(
  "canConnect true does not override linked state",
  !canRenderStage1Connect(row("instagram", "linked", true), "oauth"),
);
ok(
  "planned/none channels do not render a button",
  !canRenderStage1Connect(row("facebook", "not_available_yet", true), "none"),
);
ok(
  "mls rows do not render a button",
  !canRenderStage1Connect(row("realtor_ca", "mls_only", true), "none"),
);

eq(
  "oauth connect path reuses facebook integration start route",
  stage1ConnectHref("facebook_feed", "oauth"),
  "/api/integrations/facebook/connect",
);
eq(
  "account_login connect path reuses settings distribution channel anchor",
  stage1ConnectHref("zumper", "account_login"),
  "/dashboard/settings?tab=distribution#channel-zumper",
);
eq("none connect path is absent", stage1ConnectHref("facebook", "none"), null);
eq(
  "account_login button key",
  stage1ConnectButtonKey("account_login"),
  "buttons.login",
);
eq("oauth button key", stage1ConnectButtonKey("oauth"), "buttons.connect");
eq("none button key is absent", stage1ConnectButtonKey("none"), null);

console.log(`\nstage1-link-portals: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

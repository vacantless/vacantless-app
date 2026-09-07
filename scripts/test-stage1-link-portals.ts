// Pure tests for the S583 Stage 1 "Link your portals" grouping and copy keys.
// Run: npx tsx scripts/test-stage1-link-portals.ts
import type { ChannelTileStatusRow } from "../lib/distribution-channel-tile-statuses";
import {
  canRenderStage1Connect,
  groupStage1ChannelRows,
  stage1ConnectButtonKey,
  stage1ConnectHref,
  stage1ReasonKey,
  stage1StatusCopy,
  STAGE1_GROUPS,
} from "../lib/stage1-link-portals";
import {
  buildChannelTileStatuses,
} from "../lib/distribution-channel-tile-statuses";

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
  over: Partial<ChannelTileStatusRow> = {},
): ChannelTileStatusRow => ({
  channel,
  state,
  headline: `${channel} fallback headline that UI must not render`,
  canConnect,
  canReconnect: state === "dead_session",
  needsCheck: false,
  accountLabel: null,
  alive: null,
  lastCheckedAt: null,
  lastCheckCode: null,
  capLine: null,
  costLine: null,
  costCap: { cap: null, cost: null, spendSuffix: false, capReached: false },
  kijijiTier: null,
  ...over,
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

// --- S690 Post Everywhere Slice 1 --------------------------------------------
{
  const NOW = Date.parse("2026-09-07T15:00:00Z");
  const account = {
    channel: "rentals_ca",
    account_status: "connected",
    automation_authorized: true,
  };
  const session = {
    channel: "rentals_ca",
    account_label: "n@example.com",
    alive: true,
    cap_used: 1,
    cap_total: 3,
    last_checked_at: new Date(NOW - 60_000).toISOString(),
    last_check_code: "ok",
    last_check_error: null,
    check_pending: false,
    stale: false,
  };
  const withSession = buildChannelTileStatuses([account], [session], NOW).find(
    (r) => r.channel === "rentals_ca",
  );
  eq("connected + authorized + fresh session -> linked", withSession?.state, "linked");
  const noSession = buildChannelTileStatuses([account], [], NOW).find(
    (r) => r.channel === "rentals_ca",
  );
  eq("connected + authorized + no session row (model on) -> dead_session", noSession?.state, "dead_session");
  const unprobed = buildChannelTileStatuses(
    [account],
    [{ ...session, alive: null, last_checked_at: null, last_check_code: null, stale: true }],
    NOW,
  ).find((r) => r.channel === "rentals_ca");
  eq("connected + authorized + unprobed session -> checking", unprobed?.state, "checking");
  const modelOff = buildChannelTileStatuses([account], undefined, NOW).find(
    (r) => r.channel === "rentals_ca",
  );
  eq("connected + authorized, model off -> linked", modelOff?.state, "linked");

  ok(
    "canRenderStage1Connect true for dead_session",
    canRenderStage1Connect(row("kijiji", "dead_session", false), "account_login"),
  );
  ok(
    "canRenderStage1Connect false for dead_session with connectKind none",
    !canRenderStage1Connect(row("kijiji", "dead_session", false), "none"),
  );
  ok(
    "canRenderStage1Connect false for checking",
    !canRenderStage1Connect(row("kijiji", "checking", false), "account_login"),
  );
  ok(
    "canRenderStage1Connect false for cap_reached",
    !canRenderStage1Connect(row("kijiji", "cap_reached", false), "account_login"),
  );

  const ready = STAGE1_GROUPS[0].states;
  for (const state of ["connected_needs_authorization", "checking", "dead_session", "cap_reached"] as const) {
    ok(`ready group holds ${state}`, ready.includes(state));
    ok(`${state} has copy`, stage1StatusCopy(state).titleKey.startsWith("status."));
  }
  eq("checking tone neutral", stage1StatusCopy("checking").tone, "neutral");
  eq("dead_session tone attention", stage1StatusCopy("dead_session").tone, "attention");
  eq("cap_reached tone info", stage1StatusCopy("cap_reached").tone, "info");
  eq("connected_needs_authorization tone attention", stage1StatusCopy("connected_needs_authorization").tone, "attention");

  eq("reason key passes through", stage1ReasonKey({ lastCheckCode: "cloudflare" }), "cloudflare");
  eq("reason key unknown -> needs_login", stage1ReasonKey({ lastCheckCode: "weird" }), "needs_login");
  eq("reason key null -> needs_login", stage1ReasonKey({ lastCheckCode: null }), "needs_login");
}

// --- S691: self_post state + account_login sub lines -------------------------
eq("self_post title key", stage1StatusCopy("self_post").titleKey, "status.selfPost");
eq("self_post sub key", stage1StatusCopy("self_post").subKey, "status.selfPostSub");
eq("self_post sits in the ready group", groupStage1ChannelRows([row("facebook", "self_post", false)])[0].rows.length, 1);
eq("account_login linked sub does not promise automatic sending", stage1StatusCopy("linked", "account_login").subKey, "status.linkedSubLogin");
eq("account_login not_linked sub does not promise posting for you", stage1StatusCopy("not_linked", "account_login").subKey, "status.notLinkedSubLogin");
eq("oauth linked keeps the automatic sub", stage1StatusCopy("linked", "oauth").subKey, "status.linkedSub");

console.log(`\nstage1-link-portals: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

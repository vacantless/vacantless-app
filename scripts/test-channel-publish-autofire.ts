// Pure tests for "Publish everywhere" connected+authorized instant autofire.
// Run: npx tsx scripts/test-channel-publish-autofire.ts
import {
  selectChannelPublishAutofireItems,
  type ChannelPublishAutofireAccountRow,
  type ChannelPublishAutofireRunItem,
} from "../lib/channel-publish-autofire";

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

function item(
  channel: string,
  overrides: Partial<ChannelPublishAutofireRunItem> = {},
): ChannelPublishAutofireRunItem {
  return {
    id: `${channel}-item`,
    channel,
    mode: "automatic",
    publishStatus: "needs_operator",
    ...overrides,
  };
}

function account(
  channel: string,
  overrides: Partial<ChannelPublishAutofireAccountRow> = {},
): ChannelPublishAutofireAccountRow {
  return {
    channel,
    accountStatus: "connected",
    automationAuthorized: true,
    ...overrides,
  };
}

function select(opts: {
  runItems?: ChannelPublishAutofireRunItem[];
  accountRows?: ChannelPublishAutofireAccountRow[];
  instagramEnabled?: boolean;
} = {}) {
  return selectChannelPublishAutofireItems({
    runItems: opts.runItems ?? [],
    accountRows: opts.accountRows ?? [],
    instagramEnabled: opts.instagramEnabled,
  });
}

function keys(rows: { channel: string }[]) {
  return rows.map((row) => row.channel);
}

function has(rows: { channel: string }[], channel: string) {
  return keys(rows).includes(channel);
}

{
  const rows = select({
    runItems: [item("facebook_feed")],
    accountRows: [account("facebook_feed")],
  });
  eq("connected authorized Facebook Page is selected", keys(rows).join("|"), "facebook_feed");
}

{
  const rows = select({
    runItems: [item("facebook"), item("kijiji")],
    accountRows: [account("facebook"), account("kijiji")],
  });
  eq("copilot marketplace and kijiji are never selected", rows.length, 0);
}

{
  const rows = select({
    runItems: [item("instagram")],
    accountRows: [account("instagram")],
  });
  eq("Instagram is excluded while dark", rows.length, 0);

  const enabled = select({
    runItems: [item("instagram")],
    accountRows: [account("instagram")],
    instagramEnabled: true,
  });
  ok("Instagram is selectable when explicitly enabled", has(enabled, "instagram"));
}

{
  const rows = select({
    runItems: [item("facebook_feed")],
    accountRows: [
      account("facebook_feed", {
        automationAuthorized: false,
      }),
    ],
  });
  eq("connected but unauthorized API channel is not selected", rows.length, 0);
}

{
  const rows = select({
    runItems: [item("facebook_feed")],
    accountRows: [
      account("facebook_feed", {
        accountStatus: "needs_login",
      }),
    ],
  });
  eq("authorized but disconnected API channel is not selected", rows.length, 0);
}

{
  const rows = select({
    runItems: [
      item("facebook_feed", { publishStatus: "live" }),
      item("instagram", { publishStatus: "submitting" }),
    ],
    accountRows: [account("facebook_feed"), account("instagram")],
    instagramEnabled: true,
  });
  eq("resolved or in-flight API channels are not selected", rows.length, 0);
}

{
  const rows = select({
    runItems: [
      item("facebook_feed", {
        mode: "browser_copilot",
      }),
    ],
    accountRows: [account("facebook_feed")],
  });
  eq("non-automatic run items are not selected", rows.length, 0);
}

{
  const rows = select({
    accountRows: [account("facebook_feed")],
  });
  eq("account alone without a run item is not selected", rows.length, 0);
}

console.log(`\nchannel-publish-autofire: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

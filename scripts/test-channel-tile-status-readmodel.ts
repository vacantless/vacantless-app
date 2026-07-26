import {
  CANONICAL_CHANNEL_REGISTRY,
  CHANNEL_TILE_STATES,
  channelByKey,
} from "../lib/distribution-channels";
import {
  buildChannelTileStatuses,
  channelTileLine,
  listChannelTileStatuses,
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

const statusByChannel = (rows: ReturnType<typeof buildChannelTileStatuses>) =>
  new Map(rows.map((row) => [row.channel, row]));

async function main() {
  const rows = await listChannelTileStatuses("org_1", async (orgId) => {
    ok("mock reader receives org id", orgId === "org_1");
    return [];
  });
  ok(
    "one row per canonical registry channel",
    rows.length === CANONICAL_CHANNEL_REGISTRY.length,
  );
  ok(
    "rows stay in registry order",
    rows.map((row) => row.channel).join("|") ===
      CANONICAL_CHANNEL_REGISTRY.map((channel) => channel.key).join("|"),
  );

  {
    const statuses = statusByChannel(
      buildChannelTileStatuses([
        {
          channel: "facebook_feed",
          account_status: "connected",
          automation_authorized: true,
        },
      ]),
    );
    const status = statuses.get("facebook_feed");
    ok("connected + authorized account yields linked", status?.state === "linked");
    ok("linked account cannot connect again", status?.canConnect === false);
  }

  {
    const statuses = statusByChannel(buildChannelTileStatuses([]));
    const status = statuses.get("instagram");
    ok("missing live account yields not_linked", status?.state === "not_linked");
    ok("missing live account can connect", status?.canConnect === true);
  }

  {
    const statuses = statusByChannel(
      buildChannelTileStatuses([
        {
          channel: "facebook",
          account_status: "connected",
          automation_authorized: true,
        },
      ]),
    );
    const status = statuses.get("facebook");
    ok("planned channel stays not_available_yet", status?.state === "not_available_yet");
    ok("planned channel cannot connect", status?.canConnect === false);
  }

  {
    const statuses = statusByChannel(
      buildChannelTileStatuses([
        {
          channel: "realtor_ca",
          account_status: "connected",
          automation_authorized: true,
        },
      ]),
    );
    const status = statuses.get("realtor_ca");
    ok("realtor_ca yields mls_only", status?.state === "mls_only");
    ok("realtor_ca cannot connect", status?.canConnect === false);
  }

  {
    const rows = buildChannelTileStatuses([
      {
        channel: "not_a_registry_channel",
        account_status: "connected",
        automation_authorized: true,
      },
    ]);
    ok(
      "unknown DB account row is ignored",
      !rows.some((row) => row.channel === "not_a_registry_channel"),
    );
  }

  for (const channel of CANONICAL_CHANNEL_REGISTRY.filter(
    (channel) => channel.integrationStatus === "live",
  )) {
    for (const state of CHANNEL_TILE_STATES) {
      const line = channelTileLine(channel.key, state);
      ok(`${channel.key}: ${state} line is not legacy blurb`, line !== channel.blurb);
    }
  }

  ok(
    "rentals_ca tile line does not repeat old not-live blurb",
    !channelTileLine("rentals_ca", "not_linked").includes("not a live Vacantless integration"),
  );
  ok(
    "zumper tile line does not repeat old partner-acceptance blurb",
    !channelTileLine("zumper", "not_linked").includes("partner route is accepted"),
  );
  ok(
    "known channel line uses channel label",
    channelTileLine("kijiji", "not_linked").startsWith("Kijiji "),
  );
  ok(
    "unknown channel line is state-derived fallback",
    channelTileLine("nope", "not_available_yet") ===
      "This channel is not available for connected posting yet.",
  );
  ok("channelByKey sanity", channelByKey("facebook_feed")?.label === "Facebook Page feed");

  console.log(`\nchannel-tile-status-readmodel: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

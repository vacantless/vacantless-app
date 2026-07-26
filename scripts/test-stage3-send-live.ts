// Pure tests for the S586 Stage 3 "Choose & send live" view logic.
// Run: npx tsx scripts/test-stage3-send-live.ts
import type { ChannelTileStatusRow } from "../lib/distribution-channel-tile-statuses";
import {
  buildStage3SendRows,
  stage3AllLive,
  stage3HasSendableWork,
  stage3SendableChannels,
} from "../lib/stage3-send-live";

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
  canConnect = false,
): ChannelTileStatusRow => ({
  channel,
  state,
  headline: `${channel} fallback headline the UI must not render`,
  canConnect,
});

const tiles: ChannelTileStatusRow[] = [
  row("facebook_feed", "linked"),
  row("kijiji", "linked"),
  row("instagram", "not_linked", true),
  row("facebook", "not_available_yet"),
  row("realtor_ca", "mls_only"),
];

// --- sendable = only Stage-1 "linked" channels, in input order ---------------
const sendable = stage3SendableChannels(tiles);
eq(
  "only linked channels are sendable",
  sendable.map((r) => r.channel).join("|"),
  "facebook_feed|kijiji",
);

// --- no run item yet -> honest "waiting to start", nothing live --------------
const pending = buildStage3SendRows(sendable, new Map(), new Set());
eq("no run item -> waiting", pending[0].microKey, "waiting");
eq("no run item -> neutral tone", pending[0].tone, "neutral");
ok("no run item -> not live", pending.every((r) => !r.isLive));
ok("pending has sendable work", stage3HasSendableWork(pending));
ok("pending is not all live", !stage3AllLive(pending));

// --- submitting -> posting/warn; queued -> waiting ---------------------------
const submitting = buildStage3SendRows(
  sendable,
  new Map([
    ["facebook_feed", "submitting"],
    ["kijiji", "queued"],
  ]),
  new Set(),
);
eq("submitting -> posting", submitting[0].microKey, "posting");
eq("submitting -> warn tone", submitting[0].tone, "warn");
ok("submitting is not live", !submitting[0].isLive);
eq("queued -> waiting", submitting[1].microKey, "waiting");

// --- live + verified proof -> live/success (rule 16) -------------------------
const verified = new Set(["facebook_feed", "kijiji"]);
const live = buildStage3SendRows(
  sendable,
  new Map([
    ["facebook_feed", "live"],
    ["kijiji", "live"],
  ]),
  verified,
);
eq("verified live -> live key", live[0].microKey, "live");
eq("verified live -> success tone", live[0].tone, "success");
ok("verified live -> isLive", live[0].isLive);
ok("all verified live -> allLive", stage3AllLive(live));
ok("all live -> no remaining work", !stage3HasSendableWork(live));

// --- live but NOT verified -> honest: still posting, never LIVE! --------------
const unproven = buildStage3SendRows(
  sendable,
  new Map([
    ["facebook_feed", "live"],
    ["kijiji", "live"],
  ]),
  new Set(),
);
ok("live without proof is not marked live", unproven.every((r) => !r.isLive));
eq("live without proof reads as posting", unproven[0].microKey, "posting");
ok("live without proof still counts as work", stage3HasSendableWork(unproven));

// --- verification set null -> the item's own live status is the authority -----
const authority = buildStage3SendRows(
  sendable,
  new Map([
    ["facebook_feed", "live"],
    ["kijiji", "live"],
  ]),
  null,
);
ok("null verification set -> live status trusted", authority.every((r) => r.isLive));

// --- unknown / garbage publish_status -> waiting, not live -------------------
const garbage = buildStage3SendRows(
  sendable,
  new Map([
    ["facebook_feed", "nonsense"],
    ["kijiji", null],
  ]),
  new Set(),
);
eq("garbage status -> waiting", garbage[0].microKey, "waiting");
ok("garbage status -> null publishStatus", garbage[0].publishStatus === null);
ok("garbage status -> not live", garbage.every((r) => !r.isLive));

// --- empty sendable -> no rows, not all live, no work ------------------------
eq(
  "empty sendable -> no rows",
  buildStage3SendRows([], new Map(), new Set()).length,
  0,
);
ok("empty -> not all live", !stage3AllLive([]));
ok("empty -> no work", !stage3HasSendableWork([]));

console.log(`\nstage3-send-live: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

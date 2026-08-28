// S304: copy-truth guard between the contract layer and the channel catalog.
//
// Why this exists. The contract layer (lib/distribution-channel-contracts.ts)
// marks kijiji, rentals_ca, zumper, viewit and rentfaster as executionKind
// "headless_worker", and the worker repo really does run kijiji/rentals_ca/zumper
// as its default autopilot set. The landlord-facing catalog
// (lib/distribution-channels.ts) still described Kijiji as a place where "you
// post", with a header comment asserting we never claim automated posting for
// Kijiji. Those two statements cannot both be true, and nothing failed when they
// disagreed.
//
// This test does NOT demand that a headless_worker channel be described as
// hands-off. It must not be: every one of them is gated on a stored session,
// operator approval, and in three cases spend authorization, and none is
// rolloutState "live_proven" yet. Claiming automation would be the opposite
// error. What it demands is that the copy ACKNOWLEDGES the worker lane exists
// rather than presenting the human path as the only path.
//
// Run: npx tsx scripts/test-channel-copy-truth.ts
import {
  DISTRIBUTION_CHANNEL_CONTRACTS,
  distributionChannelContract,
} from "../lib/distribution-channel-contracts";
import { DISTRIBUTION_CHANNELS } from "../lib/distribution-channels";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}

// Channels whose catalog copy still predates the S304 correction. Each one is a
// KNOWN debt, not an exemption on principle. Removing a key from this list and
// updating its blurb is the fix; ADDING a key requires a deliberate decision and
// should be argued in review. A new headless_worker channel with manual-only copy
// fails immediately rather than joining this list by default.
const KNOWN_STALE_COPY: readonly string[] = [
  "rentals_ca",
  "zumper",
  "viewit",
  "rentfaster",
];

// Words that signal the copy admits an automated lane exists at all.
const AUTOMATION_MARKERS = ["automat", "worker", "posts for you", "post for you"];

// DISTRIBUTION_CHANNEL_CONTRACTS is an ARRAY of contract rows keyed by a
// `channel` field, not an object map. Reading it as a map silently yields
// numeric indices and every lookup misses.
const headlessKeys = DISTRIBUTION_CHANNEL_CONTRACTS.filter(
  (c) => c.executionKind === "headless_worker",
).map((c) => c.channel as string);

ok("there is at least one headless_worker channel to check", headlessKeys.length > 0);
ok("kijiji is a headless_worker channel in the contract layer", headlessKeys.includes("kijiji"));

for (const key of headlessKeys) {
  const entry = DISTRIBUTION_CHANNELS.find((c) => c.key === key);
  if (!entry) continue; // contract-only keys are not catalog rows; nothing to lint
  const blurb = (entry.blurb ?? "").toLowerCase();
  const admitsAutomation = AUTOMATION_MARKERS.some((m) => blurb.includes(m));

  if (KNOWN_STALE_COPY.includes(key)) {
    // Debt is allowed, silence is not. If someone fixes the copy, this flips and
    // tells them to drop the key from the list so the guard starts protecting it.
    ok(
      `${key}: listed as known-stale copy AND still stale (if this fails, remove it from KNOWN_STALE_COPY)`,
      !admitsAutomation,
    );
    continue;
  }

  ok(
    `${key}: catalog copy acknowledges the worker lane instead of implying the human is the only poster`,
    admitsAutomation,
  );
}

// Facebook Marketplace must stay OUT of the headless set. The worker repo asserts
// the same invariant from its side in scripts/test-autopilot-channels.ts.
ok(
  "facebook (Marketplace) is NOT headless_worker",
  !headlessKeys.includes("facebook"),
);

// Kijiji legitimately keeps its co-pilot fill path. EXTENSION_CHANNELS drives the
// real extension kit, and COPILOT_SUPPORTED_KEYS is kept in lockstep with it, so
// removing kijiji there would disable a working feature. Two paths, not one.
// While a headless lane is not rolloutState "live_proven", the copy must name a
// gate rather than implying the automation is available today. Naming the lane is
// required by the check above; naming its condition is required here.
const GATE_WORDS = ["gated", "approval", "authorization", "not yet", "coming"];
for (const key of headlessKeys) {
  const entry = DISTRIBUTION_CHANNELS.find((c) => c.key === key);
  if (!entry || KNOWN_STALE_COPY.includes(key)) continue;
  const contract = distributionChannelContract(key as never) as
    | { rolloutState?: string }
    | undefined;
  if (contract?.rolloutState === "live_proven") continue;
  const blurb = (entry.blurb ?? "").toLowerCase();
  ok(
    `${key}: copy names a gate because rolloutState is ${contract?.rolloutState ?? "unknown"}, not live_proven`,
    GATE_WORDS.some((w) => blurb.includes(w)),
  );
}

if (failed > 0) {
  console.error(`channel-copy-truth tests failed: ${failed}`);
  process.exit(1);
}
console.log(`channel-copy-truth tests passed: ${passed}`);

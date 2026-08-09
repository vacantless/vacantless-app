// S629 Slice 1 — pure tests for the Publish Everywhere mode resolver.
// Run: npx tsx scripts/test-publish-everywhere.ts

import {
  resolvePublishMode,
  summarizeReach,
  bucketForMode,
  derivePublishPreflight,
  ALWAYS_ON_INSTANT_COUNT,
  type PublishChannelInput,
  type PublishMode,
  type PublishBucket,
} from "../lib/publish-everywhere";

let failures = 0;
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    failures++;
    console.error(`FAIL: ${label} — got ${g}, want ${w}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

function mode(p: Partial<PublishChannelInput> & Pick<PublishChannelInput, "mode" | "integrationStatus">): PublishMode {
  return resolvePublishMode({
    key: p.key ?? "k",
    connectKind: p.connectKind ?? "none",
    ...p,
  } as PublishChannelInput).mode;
}

// Facebook Page / Instagram — api_automatic: instant only when connected+authorized.
eq("FB Page authorized -> instant_auto", mode({ mode: "api_automatic", integrationStatus: "live", connectedAuthorized: true }), "instant_auto");
eq("FB Page not authorized -> needs_connection", mode({ mode: "api_automatic", integrationStatus: "live", connectedAuthorized: false }), "needs_connection");

// Feed portals (Rentals.ca / Zumper) — instant only when the feed route is accepted.
eq("feed accepted -> instant_auto", mode({ mode: "feed_or_assisted", integrationStatus: "live", feedAccepted: true }), "instant_auto");
eq("feed pending -> needs_connection", mode({ mode: "feed_or_assisted", integrationStatus: "live", feedAccepted: false }), "needs_connection");

// Kijiji — live, assisted_manual, no fee -> co-pilot fill.
eq("Kijiji -> copilot_fill", mode({ mode: "assisted_manual", integrationStatus: "live", connectKind: "account_login" }), "copilot_fill");

// A live paid self-serve site -> paid_optin.
eq("live paid site -> paid_optin", mode({ mode: "assisted_manual", integrationStatus: "live", hasFee: true }), "paid_optin");

// Planned channels (FB Marketplace, RentFaster, Viewit, LinkedIn...) -> planned,
// even if they'd be a paid site — we never claim reach that isn't wired yet.
eq("planned assisted_manual -> planned", mode({ mode: "assisted_manual", integrationStatus: "planned" }), "planned");
eq("planned paid -> planned (not paid_optin)", mode({ mode: "assisted_manual", integrationStatus: "planned", hasFee: true }), "planned");

// S631 Slice 3 — a co-pilot-capable channel (Kijiji / FB Marketplace) is a
// for-you handoff even with no API and even when the catalog marks it "planned",
// because the extension fill + sidecar IS the mechanism. Channels WITHOUT a
// mechanism (copilotSupported false) still resolve as before.
eq("copilot-capable Kijiji (live) -> copilot_fill", mode({ mode: "assisted_manual", integrationStatus: "live", connectKind: "account_login", copilotSupported: true }), "copilot_fill");
eq("copilot-capable FB Marketplace (planned) -> copilot_fill", mode({ mode: "assisted_manual", integrationStatus: "planned", copilotSupported: true }), "copilot_fill");
eq("copilot-capable + paid -> paid_optin", mode({ mode: "assisted_manual", integrationStatus: "planned", hasFee: true, copilotSupported: true }), "paid_optin");
eq("copilot flag off keeps planned -> planned", mode({ mode: "assisted_manual", integrationStatus: "planned", copilotSupported: false }), "planned");
eq("broker wins over copilot-capable -> brokerage_gated", mode({ mode: "assisted_manual", integrationStatus: "mls_gated", copilotSupported: true }), "brokerage_gated");

// Realtor.ca — broker / mls_gated -> brokerage_gated.
eq("broker -> brokerage_gated", mode({ mode: "broker", integrationStatus: "mls_gated" }), "brokerage_gated");
eq("mls_gated wins over api -> brokerage_gated", mode({ mode: "api_automatic", integrationStatus: "mls_gated" }), "brokerage_gated");

// Bucketing.
eq("instant_auto -> instant", bucketForMode("instant_auto"), "instant");
eq("copilot_fill -> for_you", bucketForMode("copilot_fill"), "for_you");
eq("paid_optin -> for_you", bucketForMode("paid_optin"), "for_you");
eq("needs_connection -> after_setup", bucketForMode("needs_connection"), "after_setup");
eq("brokerage_gated -> after_setup", bucketForMode("brokerage_gated"), "after_setup");
eq("planned -> after_setup", bucketForMode("planned"), "after_setup");

// Reach summary: always-on (page + email) count as instant; "included" = instant + for_you.
const buckets: PublishBucket[] = ["instant", "instant", "instant", "for_you", "for_you", "after_setup", "after_setup"];
const reach = summarizeReach(buckets);
eq("reach.instant (3 + 2 always-on)", reach.instant, 3 + ALWAYS_ON_INSTANT_COUNT);
eq("reach.for_you", reach.for_you, 2);
eq("reach.after_setup", reach.after_setup, 2);
eq("reach.included = instant + for_you", reach.included, 3 + ALWAYS_ON_INSTANT_COUNT + 2);
eq("reach without always-on", summarizeReach(["instant"], false).instant, 1);

// Front-loaded preflight: sign-in rows are exactly the for-you modes; paid rows
// carry honest fee labels and are never checked by default.
const preflight = derivePublishPreflight([
  { key: "site", label: "Vacantless page", mode: "instant_auto" },
  { key: "kijiji", label: "Kijiji", mode: "copilot_fill" },
  {
    key: "viewit",
    label: "Viewit.ca",
    mode: "paid_optin",
    feeLabel: "$54.95/mo",
    feeCents: 5495,
  },
  { key: "linkedin", label: "LinkedIn", mode: "planned" },
]);
eq(
  "preflight sign-in needed = copilot + paid",
  preflight.signInNeeded.map((row) => row.key),
  ["kijiji", "viewit"],
);
eq(
  "preflight fee channels",
  preflight.feeChannels.map((row) => ({
    key: row.key,
    feeLabel: row.feeLabel,
    feeCents: row.feeCents,
    selectedByDefault: row.selectedByDefault,
  })),
  [
    {
      key: "viewit",
      feeLabel: "$54.95/mo",
      feeCents: 5495,
      selectedByDefault: false,
    },
  ],
);
eq(
  "preflight unknown paid fee stays honest",
  derivePublishPreflight([
    { key: "rentfaster", label: "RentFaster.ca", mode: "paid_optin" },
  ]).feeChannels[0]?.feeLabel,
  "a site fee may apply",
);
eq(
  "preflight paid default off",
  preflight.feeChannels.every((row) => row.selectedByDefault === false),
  true,
);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll publish-everywhere resolver tests passed.");

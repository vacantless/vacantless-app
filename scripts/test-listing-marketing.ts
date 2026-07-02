// Unit tests for the pure listing-marketing kit logic.
// Run: npx tsx scripts/test-listing-marketing.ts
import {
  type KitChannel,
  postChannels,
  buildPostChecklist,
  buildCombinedText,
  buildMarketingKit,
  qrFilename,
} from "../lib/listing-marketing";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const CHANNELS: KitChannel[] = [
  { key: "generic", label: "Master copy", title: "G title", body: "G body" },
  { key: "kijiji", label: "Kijiji", title: "K title", body: "K body" },
  { key: "facebook", label: "Facebook Marketplace", title: "F title", body: "F body" },
];

// --- postChannels: master excluded -----------------------------------------
ok("postChannels drops generic", postChannels(CHANNELS).length === 2);
ok(
  "postChannels keeps real channels",
  postChannels(CHANNELS).every((c) => c.key !== "generic"),
);
ok("postChannels on empty -> empty", postChannels([]).length === 0);

// --- buildPostChecklist ----------------------------------------------------
const checklist = buildPostChecklist(CHANNELS);
ok("checklist excludes master", !checklist.includes("Master copy"));
ok("checklist has Kijiji + Facebook", checklist.includes("Kijiji") && checklist.includes("Facebook Marketplace"));
ok("checklist length 2", checklist.length === 2);

// --- buildCombinedText: Live (landing link present) ------------------------
const live = buildCombinedText({
  businessName: "Agile Rentals",
  address: "123 Main St, Windsor",
  landingUrl: "https://app.vacantless.com/r/abc",
  channels: CHANNELS,
});
ok("combined: header has business + address", live.startsWith("Agile Rentals - 123 Main St, Windsor"));
ok("combined: includes landing link", live.includes("Details and apply: https://app.vacantless.com/r/abc"));
ok("combined: includes each channel header", live.includes("== Kijiji ==") && live.includes("== Facebook Marketplace ==") && live.includes("== Master copy =="));
ok("combined: includes channel bodies", live.includes("K body") && live.includes("F body"));
ok("combined: no trailing blank line", !live.endsWith("\n"));
ok("combined: no em dash leaks", !live.includes("—") && !live.includes("–"));

// --- buildCombinedText: not Live (no landing link) -------------------------
const draft = buildCombinedText({
  businessName: null,
  address: "9 Oak Ave",
  landingUrl: null,
  channels: CHANNELS,
});
ok("combined draft: header is address only", draft.startsWith("9 Oak Ave"));
ok("combined draft: no apply link", !draft.includes("Details and apply:"));
ok("combined draft: prompts to set Live", draft.includes("Set this rental Live"));
const leased = buildCombinedText({
  businessName: null,
  address: "18 Shorncliffe Avenue",
  landingUrl: null,
  missingLinkText: "Relist this rental as Live before adding a public listing link.",
  channels: CHANNELS,
});
ok("combined closed: accepts custom missing-link copy", leased.includes("Relist this rental as Live"));

// --- buildMarketingKit -----------------------------------------------------
const kit = buildMarketingKit({
  businessName: "Agile Rentals",
  address: "123 Main St, Windsor",
  landingUrl: "https://app.vacantless.com/r/abc",
  channels: CHANNELS,
});
ok("kit: landingUrl passthrough", kit.landingUrl === "https://app.vacantless.com/r/abc");
ok("kit: channels passthrough", kit.channels.length === 3);
ok("kit: combinedText built", kit.combinedText.includes("== Kijiji =="));
ok("kit: postChecklist built", kit.postChecklist.length === 2);

const kitNull = buildMarketingKit({
  businessName: null,
  address: "9 Oak Ave",
  landingUrl: null,
  channels: [],
});
ok("kit: null landing tolerated", kitNull.landingUrl === null);
ok("kit: empty channels -> empty checklist", kitNull.postChecklist.length === 0);

// --- qrFilename ------------------------------------------------------------
ok("qrFilename: slugifies", qrFilename("123 Main St, Windsor") === "listing-qr-123-main-st-windsor.svg");
ok("qrFilename: trims unsafe + collapses", qrFilename("  A//B  ") === "listing-qr-a-b.svg");
ok("qrFilename: empty -> rental fallback", qrFilename("") === "listing-qr-rental.svg");
ok("qrFilename: always .svg", qrFilename("anything").endsWith(".svg"));

// --- summary ---------------------------------------------------------------
console.log(`\nlisting-marketing: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

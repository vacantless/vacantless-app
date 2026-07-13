// Unit tests for the pure browser co-pilot script model (S482). Run on device:
//   node_modules/.bin/esbuild scripts/test-distribution-copilot.ts --bundle \
//     --platform=node --format=cjs --alias:@=. --outfile=/tmp/tc.cjs && node /tmp/tc.cjs
import {
  buildCopilotScript,
  isCopilotChannel,
  canMarkCopilotLive,
  stopGateLabel,
  stopGateNote,
  type CopilotScript,
} from "@/lib/distribution-copilot";

let pass = 0;
let fail = 0;
function eq(got: unknown, want: unknown, msg: string): void {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.error(`FAIL: ${msg} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
function ok(c: boolean, msg: string): void {
  if (c) pass++;
  else {
    fail++;
    console.error("FAIL:", msg);
  }
}

const BASE = {
  address: "18 Shorncliffe Avenue",
  rentCents: 220000,
  beds: 2,
  baths: 1,
  description: "Bright renovated unit near transit.",
  businessName: "North Star Rentals",
};
const TRACKED = "https://app.vacantless.com/r/abc123?p=post1";

// --- isCopilotChannel -------------------------------------------------------
ok(isCopilotChannel("facebook"), "facebook is a co-pilot channel");
ok(isCopilotChannel("kijiji"), "kijiji is a co-pilot channel");
ok(isCopilotChannel("viewit"), "viewit is a co-pilot channel");
ok(!isCopilotChannel("vacantless"), "vacantless is NOT co-pilot (automatic)");
ok(!isCopilotChannel("org_feed"), "org_feed is NOT co-pilot (automatic)");
ok(!isCopilotChannel("rentals_ca"), "rentals_ca is NOT co-pilot (feed partner)");
ok(!isCopilotChannel("zumper"), "zumper is NOT co-pilot (feed partner)");
ok(!isCopilotChannel("realtor_ca"), "realtor_ca is NOT co-pilot (broker)");
ok(!isCopilotChannel("other"), "other is NOT co-pilot (custom)");

// --- non-copilot channels return null --------------------------------------
for (const c of ["vacantless", "org_feed", "network_feed", "rentals_ca", "zumper", "realtor_ca", "other"] as const) {
  eq(
    buildCopilotScript({ channel: c, copy: BASE, trackedUrl: TRACKED, publicPageLive: true }),
    null,
    `buildCopilotScript(${c}) => null`,
  );
}

// --- kijiji script ----------------------------------------------------------
const kj = buildCopilotScript({ channel: "kijiji", copy: BASE, trackedUrl: TRACKED, publicPageLive: true }) as CopilotScript;
ok(kj !== null, "kijiji script is not null");
eq(kj.channel, "kijiji", "kijiji channel");
eq(kj.transport, "browser_copilot", "kijiji transport = browser_copilot");
eq(kj.transportLabel, "Browser co-pilot", "kijiji transport label");
eq(kj.portalUrl, "https://www.kijiji.ca/p-post-ad.html", "kijiji portal url");
eq(kj.requiresLiveUrlToComplete, true, "kijiji requires live url to complete");
ok(kj.stopGates.includes("login"), "kijiji stop gate: login");
ok(kj.stopGates.includes("captcha"), "kijiji stop gate: captcha");
ok(kj.stopGates.includes("final_review"), "kijiji stop gate: final_review");
ok(!kj.stopGates.includes("payment"), "kijiji has NO payment gate");
ok(kj.fields.some((f) => f.key === "title" && f.value.length > 0), "kijiji has a non-empty title field");
ok(kj.fields.some((f) => f.key === "body" && f.value.includes(TRACKED)), "kijiji body carries the tracked link");
ok(kj.fields.some((f) => f.key === "price" && f.value === "$2,200/month"), "kijiji price field = formatted rent");
ok(kj.fields.some((f) => f.key === "address" && f.value === BASE.address), "kijiji address field");
ok(kj.fields.some((f) => f.key === "tracked_link" && f.value === TRACKED), "kijiji tracked_link field");
ok(kj.steps.some((s) => s.stopGate === "login"), "kijiji has a login stop-gate step");
ok(kj.steps.some((s) => s.stopGate === "final_review"), "kijiji has a final_review stop-gate step");
ok(!kj.steps.some((s) => s.stopGate === "payment"), "kijiji has NO payment stop-gate step");
ok(kj.steps.some((s) => s.key === "paste_url"), "kijiji has a paste_url step");
ok(kj.steps[0].key === "open", "kijiji first step opens the portal");
ok(kj.honesty.some((h) => h.includes("marked live") && h.includes("proof")), "kijiji honesty: never live without proof");
ok(kj.blockers.length === 0, "kijiji: no blockers when page live + tracked link present");

// --- viewit: adds the payment gate -----------------------------------------
const vi = buildCopilotScript({ channel: "viewit", copy: BASE, trackedUrl: TRACKED, publicPageLive: true }) as CopilotScript;
ok(vi.stopGates.includes("payment"), "viewit stop gate: payment");
ok(vi.steps.some((s) => s.stopGate === "payment"), "viewit has a payment stop-gate step");
ok(vi.honesty.some((h) => h.toLowerCase().includes("payment")), "viewit honesty mentions payment");

// --- facebook: photo-dedup guidance ----------------------------------------
const fb = buildCopilotScript({ channel: "facebook", copy: BASE, trackedUrl: TRACKED, publicPageLive: true }) as CopilotScript;
ok(fb.steps.some((s) => s.key === "fields_photos" && (s.detail ?? "").includes("Facebook flags duplicate photos")), "facebook photo-dedup reminder");
ok(!fb.stopGates.includes("payment"), "facebook has NO payment gate");

// --- blockers when the public page is not live -----------------------------
const kjDark = buildCopilotScript({ channel: "kijiji", copy: BASE, trackedUrl: null, publicPageLive: false }) as CopilotScript;
ok(kjDark.blockers.length === 1, "kijiji surfaces a blocker when page not live / no tracked link");
ok(kjDark.blockers[0].includes("public page first"), "blocker names the public page prerequisite");
ok(!kjDark.fields.some((f) => f.key === "tracked_link"), "no tracked_link field when there is no tracked url");

// --- canMarkCopilotLive: never live without a real URL ---------------------
ok(canMarkCopilotLive("https://www.kijiji.ca/v-apartments-condos/123"), "https url can mark live");
ok(canMarkCopilotLive("http://facebook.com/marketplace/item/1"), "http url can mark live");
ok(!canMarkCopilotLive(null), "null cannot mark live");
ok(!canMarkCopilotLive(""), "empty cannot mark live");
ok(!canMarkCopilotLive("   "), "whitespace cannot mark live");
ok(!canMarkCopilotLive("kijiji.ca/v/123"), "scheme-less url cannot mark live");
ok(!canMarkCopilotLive("ftp://example.com/x"), "ftp url cannot mark live");

// --- label/note helpers -----------------------------------------------------
eq(stopGateLabel("login"), "You sign in", "stopGateLabel login");
eq(stopGateLabel("nope"), "", "stopGateLabel unknown => empty");
ok(stopGateNote("login", "Kijiji").includes("never stores or enters"), "login note is honest");
ok(stopGateNote("captcha", "Kijiji").includes("CAPTCHA"), "captcha note mentions CAPTCHA");

console.log(`test-distribution-copilot: ${pass}/${fail}`);
if (fail > 0) process.exit(1);

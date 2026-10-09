// Run with: npx tsx scripts/test-video-ad.ts
// S702: 15-second video ad from a rental's photos.
import { readFileSync } from "node:fs";
import {
  VIDEO_MS,
  buildVideoAdPlan,
  cleanHook,
  frameAt,
  pickVideoType,
  videoFilename,
  zoomAt,
} from "../lib/video-ad";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const base = { rentCents: 150000, beds: 2, baths: 1, address: "12 Elm St, Windsor", hook: null };
ok("no photos, no video", buildVideoAdPlan({ ...base, photoUrls: [] }) === null);
const plan = buildVideoAdPlan({ ...base, photoUrls: ["a", "b", "c", "d", "e", "f", "g"] })!;
ok("at most 5 photos", plan.photos.length === 5);
ok("3 seconds each", plan.slideMs === 3000);
ok("price label", plan.price === "$1,500/month");
ok("details", plan.details === "2 bed · 1 bath");
ok("fallback hook", plan.hook === "2 bed, 1 bath for rent");
ok("studio", buildVideoAdPlan({ ...base, beds: 0, baths: null, photoUrls: ["a"] })!.hook === "Studio for rent");
ok("no rent, no price", buildVideoAdPlan({ ...base, rentCents: null, photoUrls: ["a"] })!.price === null);

ok("hook trimmed to 6 words", cleanHook("Bright sunny corner unit with brand new kitchen") === "Bright sunny corner unit with brand");
ok("hook drops em dash", !/[—–]/.test(cleanHook("Quiet street — big yard") ?? ""));
ok("NO_HOOK is null", cleanHook("NO_HOOK") === null);
ok("link is null", cleanHook("see https://x.com") === null);
ok("AI hook used", buildVideoAdPlan({ ...base, hook: "Big sunny balcony.", photoUrls: ["a"] })!.hook === "Big sunny balcony");

const f0 = frameAt(plan, 0);
ok("starts on photo 1", f0.index === 0 && f0.fadeNext === 0);
const fFade = frameAt(plan, 2800);
ok("fades near the end of a slide", fFade.index === 0 && fFade.fadeNext > 0);
ok("last slide never fades", frameAt(plan, VIDEO_MS - 10).fadeNext === 0 && frameAt(plan, VIDEO_MS - 10).index === 4);
ok("time past the end clamps", frameAt(plan, VIDEO_MS + 5000).index === 4);
ok("zoom range", zoomAt(0) === 1 && Math.abs(zoomAt(1) - 1.12) < 1e-9 && zoomAt(5) === zoomAt(1));

ok("prefers mp4", pickVideoType(() => true) === "video/mp4;codecs=avc1");
ok("falls back to webm", pickVideoType((t) => t === "video/webm") === "video/webm");
ok("none supported", pickVideoType(() => false) === null);
ok("mp4 filename", videoFilename("12 Elm St, Windsor", "video/mp4") === "12-elm-st-windsor-video-ad.mp4");
ok("webm filename", videoFilename("", "video/webm") === "rental-video-ad.webm");

const card = readFileSync("app/dashboard/properties/[id]/video-ad-card.tsx", "utf8");
ok("photos loaded cross origin", card.includes('img.crossOrigin = "anonymous"'));
const actions = readFileSync("app/dashboard/properties/[id]/video-ad-actions.ts", "utf8");
ok("hook scoped to org", actions.includes('.eq("organization_id", org.id)'));
ok("hook never sees address or price", actions.includes("address: null, rent_cents: null"));
const page = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
ok("card on rental page with public address", page.includes("<VideoAdCard") && page.includes("publicAddressLabel({ address: p.address, mode: p.address_display_mode })"));

console.log(`\nvideo-ad: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

// S802: the "?" help map (lib/page-help.ts). Run: npx tsx scripts/test-page-help.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { PAGE_HELP_ROUTES, helpVideosFor } from "../lib/page-help";
import { HOW_TO_VIDEOS } from "../lib/how-to-videos";

let n = 0;
function ok(name: string, fn: () => void) { fn(); n++; console.log("ok", name); }
const nums = (p: string) => helpVideosFor(p).map((v) => v.n);

ok("every route names real videos with their files", () => {
  for (const [prefix, vids] of PAGE_HELP_ROUTES) {
    assert.ok(vids.length > 0, prefix);
    for (const v of vids) {
      assert.ok(HOW_TO_VIDEOS.some((h) => h.n === v), `${prefix} -> ${v}`);
      assert.ok(existsSync(`public/videos/howto-${v}.mp4`), `howto-${v}.mp4`);
      assert.ok(existsSync(`public/videos/howto-${v}.jpg`), `howto-${v}.jpg`);
    }
  }
});
ok("every route prefix is a real dashboard page", () => {
  for (const [prefix] of PAGE_HELP_ROUTES) {
    const rel = prefix.replace(/\/$/, "").replace("/dashboard/getting-started", "/dashboard/(wizard)/getting-started");
    assert.ok(existsSync(`app${rel}/page.tsx`) || existsSync(`app${rel}`), prefix);
  }
});
ok("pages get the right video first", () => {
  assert.deepEqual(nums("/dashboard/properties"), [1]);
  assert.deepEqual(nums("/dashboard/properties/new"), [1]);
  assert.deepEqual(nums("/dashboard/properties/abc-123"), [1, 4]);
  assert.deepEqual(nums("/dashboard/properties/abc-123?tab=posting"), [1, 4]);
  assert.deepEqual(nums("/dashboard/availability"), [2]);
  assert.deepEqual(nums("/dashboard/leads/xyz"), [3]);
  assert.deepEqual(nums("/dashboard/sites"), [4]);
  assert.deepEqual(nums("/dashboard/showing-agents"), [5, 8]);
  assert.deepEqual(nums("/dashboard/showings"), [6]);
  assert.deepEqual(nums("/dashboard/settings/notifications"), [7]);
  assert.deepEqual(nums("/dashboard/tenancies"), [10]);
  assert.deepEqual(nums("/dashboard/tenancies/t1/lease/l1/standard"), [10, 9]);
  assert.deepEqual(nums("/dashboard/money/tax-package"), [10]);
});
ok("no prefix swallows a neighbour (showings vs showing-agents, rent vs rental)", () => {
  assert.deepEqual(nums("/dashboard/showings-x"), []);
  assert.deepEqual(nums("/dashboard/rental"), []);
});
ok("pages with no video get the full list", () => {
  for (const p of ["/dashboard", "/dashboard/settings", "/dashboard/billing", "/dashboard/crew", "", null]) {
    assert.deepEqual(nums(p as string), [], String(p));
  }
});
ok("the button sits in the dashboard header", () => {
  const layout = readFileSync("app/dashboard/layout.tsx", "utf8");
  assert.match(layout, /<PageHelp \/>/);
  const comp = readFileSync("components/page-help.tsx", "utf8");
  assert.ok(!comp.includes("—"));
});
ok("home screen: manifest names real icons and starts in the dashboard", () => {
  const m = readFileSync("app/manifest.ts", "utf8");
  assert.match(m, /start_url: "\/dashboard"/);
  assert.match(m, /display: "standalone"/);
  for (const [f, px] of [["public/icon-192.png", 192], ["public/icon-512.png", 512]] as const) {
    const b = readFileSync(f);
    assert.equal(b.readUInt32BE(16), px, f);
    assert.equal(b.readUInt32BE(20), px, f);
  }
  assert.match(readFileSync("app/layout.tsx", "utf8"), /appleWebApp/);
});
console.log(`\n${n} passed`);

// S802: the "?" help map (lib/page-help.ts). Run: npx tsx scripts/test-page-help.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { PAGE_HELP_ROUTES, helpVideosFor } from "../lib/page-help";
import { HOW_TO_VIDEOS, HOW_TO_FILE_VERSION, howToVideoSrc, howToPosterSrc } from "../lib/how-to-videos";
import { createHash } from "node:crypto";

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
  assert.deepEqual(nums("/dashboard/leads/xyz"), [3, 11, 6]);
  assert.deepEqual(nums("/dashboard/leads"), [3, 12]);
  // S816: Today, Leasing overview and Reports are pre-lease, not "After you lease".
  assert.deepEqual(nums("/dashboard"), [3, 6]);
  assert.deepEqual(nums("/dashboard/"), [3, 6]);
  assert.deepEqual(nums("/dashboard/leasing"), [3, 6]);
  assert.deepEqual(nums("/dashboard/reports"), [6, 3]);
  assert.deepEqual(nums("/dashboard/sites"), [4]);
  assert.deepEqual(nums("/dashboard/showing-agents"), [5, 8]);
  assert.deepEqual(nums("/dashboard/showings"), [6]);
  assert.deepEqual(nums("/dashboard/settings/notifications"), [7]);
  assert.deepEqual(nums("/dashboard/tenancies"), [10]);
  assert.deepEqual(nums("/dashboard/tenancies/t1/lease/l1/standard"), [10, 9]);
  assert.deepEqual(nums("/dashboard/money/tax-package"), [10]);
  assert.deepEqual(nums("/dashboard/settings"), [7]);
  assert.deepEqual(nums("/dashboard/crew"), [10]);
  assert.deepEqual(nums("/dashboard/people/p1"), [11, 6, 10]);
  assert.deepEqual(nums("/dashboard/numbers"), [7, 3]);
});
ok("no prefix swallows a neighbour (showings vs showing-agents, rent vs rental)", () => {
  assert.deepEqual(nums("/dashboard/showings-x"), []);
  assert.deepEqual(nums("/dashboard/rental"), []);
});
ok("pages with no video get the full list", () => {
  // S818: Settings, Crew, People, Phone book and Me now open a matching video.
  for (const p of ["/dashboard/billing", "", null]) {
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
// S816: each video's stamp matches its files, so a re-shot video or a new
// poster can't be served from an old copy, and every page uses the stamp.
ok("every video and poster carries its current stamp", () => {
  for (const v of HOW_TO_VIDEOS) {
    const h = createHash("md5")
      .update(readFileSync(`public/videos/howto-${v.n}.mp4`))
      .update(readFileSync(`public/videos/howto-${v.n}.jpg`))
      .digest("hex")
      .slice(0, 8);
    assert.equal(HOW_TO_FILE_VERSION[v.n], h, `howto-${v.n}: re-shot? set HOW_TO_FILE_VERSION[${v.n}] = "${h}"`);
    assert.ok(howToVideoSrc(v.n).endsWith(`?v=${h}`) && howToPosterSrc(v.n).endsWith(`?v=${h}`));
  }
  for (const f of ["components/page-help.tsx", "app/how-to/page.tsx", "app/fix/[slug]/page.tsx"]) {
    assert.ok(!/\/videos\/howto-\$\{/.test(readFileSync(f, "utf8")), `${f} uses howToVideoSrc/howToPosterSrc`);
  }
});
console.log(`\n${n} passed`);

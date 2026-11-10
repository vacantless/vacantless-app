// S777: the friction pages (lib/friction-pages.ts, app/fix). Run: npx tsx scripts/test-friction-pages.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { FRICTION_PAGES, frictionPage, frictionPath } from "../lib/friction-pages";
import { HOW_TO_VIDEOS } from "../lib/how-to-videos";
import { isMarketingPath } from "../lib/ad-conversions";
import { MAX_SENTENCE_WORDS } from "../lib/i18n/plain-words";

let n = 0;
function ok(name: string, fn: () => void) { fn(); n++; console.log("ok", name); }

ok("twelve pages, unique slugs, url-safe", () => {
  assert.equal(FRICTION_PAGES.length, 12);
  const slugs = FRICTION_PAGES.map((f) => f.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const s of slugs) assert.match(s, /^[a-z0-9-]+$/);
});
ok("each page: three fix steps, at least two how lines, a plan", () => {
  for (const f of FRICTION_PAGES) {
    assert.equal(f.fix.length, 3, f.slug);
    assert.ok(f.how.length >= 2, f.slug);
    assert.ok(f.plan.length > 0, f.slug);
  }
});
ok("every video is a real how-to with its file", () => {
  for (const f of FRICTION_PAGES) {
    if (f.video == null) continue;
    assert.ok(HOW_TO_VIDEOS.some((v) => v.n === f.video), f.slug);
    assert.ok(existsSync(`public/videos/howto-${f.video}.mp4`), f.slug);
  }
});
ok("no em dashes, sentences short", () => {
  for (const f of FRICTION_PAGES) {
    const all = [f.title, f.problem, ...f.fix, ...f.how, f.plan];
    for (const t of all) {
      assert.ok(!t.includes("—"), `${f.slug}: ${t}`);
      for (const s of t.split(/(?<=[.?!])\s+/)) {
        const words = s.split(/\s+/).filter(Boolean).length;
        assert.ok(words <= MAX_SENTENCE_WORDS, `${f.slug}: "${s}" has ${words} words`);
      }
    }
  }
});
ok("no back-office words on a landlord page", () => {
  // The plain-language gate's list is about posting screens; "pre-authorized
  // debit" and YES are the right words here. These never are.
  const never = /\b(portal|channel|lead|leads|publish|sync|syndicat\w*|tenancy|concierge|worker)\b/i;
  for (const f of FRICTION_PAGES) {
    for (const t of [f.title, f.problem, ...f.fix, ...f.how, f.plan]) assert.ok(!never.test(t), `${f.slug}: ${t}`);
  }
});
ok("lookup, paths, sitemap and ad tags", () => {
  assert.equal(frictionPage("no-shows")?.video, 6);
  assert.equal(frictionPage("nope"), null);
  assert.equal(frictionPath("no-shows"), "/fix/no-shows");
  assert.ok(isMarketingPath("/fix") && isMarketingPath("/fix/no-shows"));
  assert.ok(readFileSync("app/sitemap.ts", "utf8").includes("FRICTION_PAGES.map"));
});
ok("emergencies and repairs are marked as a paid plan (S779 door bands)", () => {
  assert.equal(frictionPage("repairs-and-emergencies")?.plan, "Any paid plan, from CA$29 a month.");
});
console.log(`friction-pages: ${n} passed`);

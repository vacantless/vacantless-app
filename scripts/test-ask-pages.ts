// S783: the landlord question pages (lib/ask-pages.ts, app/ask). Run: npx tsx scripts/test-ask-pages.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { ASK_CHECKED, ASK_PAGES, askJsonLd, askPage, askPath } from "../lib/ask-pages";
import { FRICTION_PAGES } from "../lib/friction-pages";
import { isMarketingPath } from "../lib/ad-conversions";
import { MAX_SENTENCE_WORDS } from "../lib/i18n/plain-words";

let n = 0;
function ok(name: string, fn: () => void) { fn(); n++; console.log("ok", name); }
const textOf = (p: (typeof ASK_PAGES)[number]) => [p.question, p.answer, ...p.details, p.related?.label ?? ""];

ok("ten pages, unique url-safe slugs, each a question", () => {
  assert.equal(ASK_PAGES.length, 10);
  const slugs = ASK_PAGES.map((p) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const p of ASK_PAGES) {
    assert.match(p.slug, /^[a-z0-9-]+$/);
    assert.ok(p.question.endsWith("?"), p.slug);
    assert.ok(p.details.length >= 4, p.slug);
    assert.ok(p.sources.length >= 1, p.slug);
    for (const s of p.sources) assert.match(s.url, /^https:\/\//, p.slug);
  }
});
ok("no em dashes, sentences within the plain-language gate", () => {
  for (const p of ASK_PAGES) {
    for (const t of textOf(p)) {
      assert.ok(!t.includes("—"), `${p.slug}: ${t}`);
      for (const s of t.split(/(?<=[.?!])\s+/)) {
        const words = s.split(/\s+/).filter(Boolean).length;
        assert.ok(words <= MAX_SENTENCE_WORDS, `${p.slug}: "${s}" has ${words} words`);
      }
    }
  }
});
ok("answers never sell: no product name in question or answer", () => {
  for (const p of ASK_PAGES) assert.ok(!/vacantless/i.test(p.question + p.answer), p.slug);
});
ok("related links go to pages that exist", () => {
  const fix = new Set(FRICTION_PAGES.map((f) => `/fix/${f.slug}`));
  for (const p of ASK_PAGES) {
    const h = p.related?.href;
    if (!h) continue;
    if (h.startsWith("/fix/")) assert.ok(fix.has(h), `${p.slug}: ${h}`);
    else if (h === "/tools") assert.ok(existsSync("app/tools/page.tsx"));
    else assert.ok(existsSync(`app${h}/page.tsx`), `${p.slug}: ${h}`);
  }
});
ok("the yearly numbers match the rules the tools use", () => {
  assert.equal(ASK_CHECKED, "2026-11-12");
  assert.match(askPage("ontario-rent-increase-2027")!.answer, /1\.9%/);
  assert.match(askPage("when-can-i-give-an-n4")!.answer, /7 days/);
  assert.match(askPage("do-i-have-to-pay-n12-compensation")!.answer, /120 days/);
  assert.ok(readFileSync("lib/n4.ts", "utf8").includes('N4_SEVEN_DAY_RULE_FROM = "2026-09-21"'));
  assert.ok(readFileSync("lib/n12.ts", "utf8").includes("N12_NO_COMPENSATION_DAYS = 120"));
});
ok("lookup, paths, sitemap, ad tags and FAQ markup", () => {
  assert.equal(askPage("nope"), null);
  assert.equal(askPath("tenant-refuses-to-accept-notice"), "/ask/tenant-refuses-to-accept-notice");
  assert.ok(isMarketingPath("/ask") && isMarketingPath("/ask/when-can-i-give-an-n4"));
  assert.ok(readFileSync("app/sitemap.ts", "utf8").includes("ASK_PAGES.map"));
  const ld = askJsonLd(ASK_PAGES[0]) as { "@type": string; mainEntity: { name: string }[] };
  assert.equal(ld["@type"], "FAQPage");
  assert.equal(ld.mainEntity[0].name, ASK_PAGES[0].question);
});
console.log(`ask-pages: ${n} passed`);

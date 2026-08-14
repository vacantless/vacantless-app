// Unit tests for S654 lead attribution fallback helpers and source wiring.
// Run: npx tsx scripts/test-lead-attribution.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  leadAttributionReferrerEnabled,
  leadAttributionTrackedCopyEnabled,
  leadFallbackAttributionFromSignals,
  leadSourceLabelForReferrerHost,
  normalizeLeadReferrerHost,
  normalizeLeadUtmSource,
} from "../lib/lead-attribution";

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

assert.equal(leadAttributionReferrerEnabled({}), false);
assert.equal(leadAttributionReferrerEnabled({ LEAD_ATTRIBUTION_REFERRER_ENABLED: "1" }), true);
assert.equal(leadAttributionReferrerEnabled({ LEAD_ATTRIBUTION_REFERRER_ENABLED: "true" }), false);
assert.equal(leadAttributionTrackedCopyEnabled({}), false);
assert.equal(leadAttributionTrackedCopyEnabled({ LEAD_ATTRIBUTION_TRACKED_COPY_ENABLED: "1" }), true);
assert.equal(
  leadAttributionTrackedCopyEnabled({ LEAD_ATTRIBUTION_TRACKED_COPY_ENABLED: "true" }),
  false,
);

assert.equal(
  normalizeLeadReferrerHost("https://www.Facebook.com/marketplace/item/1"),
  "facebook.com",
);
assert.equal(normalizeLeadReferrerHost(" WWW.KIJIJI.CA "), "kijiji.ca");
assert.equal(normalizeLeadReferrerHost("facebook .com"), null);
assert.equal(normalizeLeadReferrerHost("facebook.com/marketplace"), null);
assert.equal(normalizeLeadReferrerHost("a".repeat(121)), null);
assert.equal(normalizeLeadReferrerHost(null), null);

assert.equal(normalizeLeadUtmSource(" Kijiji "), "kijiji");
assert.equal(normalizeLeadUtmSource("rentals.ca"), "rentals.ca");
assert.equal(normalizeLeadUtmSource("rentals ca"), null);
assert.equal(normalizeLeadUtmSource("rentals.ca/path"), null);
assert.equal(normalizeLeadUtmSource("a".repeat(121)), null);

const hostLabels: Array<[string, string | null]> = [
  ["facebook.com", "Facebook Marketplace"],
  ["m.facebook.com", "Facebook Marketplace"],
  ["l.facebook.com", "Facebook Marketplace"],
  ["lm.facebook.com", "Facebook Marketplace"],
  ["kijiji.ca", "Kijiji"],
  ["rentals.ca", "Rentals.ca"],
  ["rentfaster.ca", "RentFaster.ca"],
  ["zumper.com", "Zumper + PadMapper"],
  ["viewit.ca", "Viewit.ca"],
  ["instagram.com", "Instagram"],
  ["google.ca", "Search"],
  ["bing.com", "Search"],
  ["duckduckgo.com", "Search"],
  ["unknown.example", null],
];
for (const [host, label] of hostLabels) {
  assert.equal(leadSourceLabelForReferrerHost(host), label, host);
}

assert.deepEqual(leadFallbackAttributionFromSignals({}), {
  source: "website",
  sourceDetail: null,
});
assert.deepEqual(
  leadFallbackAttributionFromSignals({
    referrerHost: "facebook.com",
    utmSource: "kijiji",
  }),
  { source: "Kijiji", sourceDetail: "utm:kijiji" },
);
assert.deepEqual(
  leadFallbackAttributionFromSignals({ referrerHost: "unknown.example" }),
  { source: "website", sourceDetail: "ref:unknown.example" },
);
assert.deepEqual(
  leadFallbackAttributionFromSignals({ utmSource: "unknown" }),
  { source: "website", sourceDetail: "utm:unknown" },
);

const migration = read("supabase/migrations/0214_lead_attribution_referrer_fallback.sql");
assert.equal(/drop\s+function/i.test(migration), false);
assert.match(
  migration,
  /p_source_hint\s+text\s+default\s+null,\s*p_referrer_host\s+text\s+default\s+null,\s*p_utm_source\s+text\s+default\s+null\s*\)/i,
);
assert.equal(migration.includes("if v_post is null then"), true);
assert.equal(migration.includes("v_source_det := 'utm:' || v_utm"), true);
assert.equal(migration.includes("v_source_det := 'ref:' || v_ref_host"), true);
assert.equal(migration.includes("elsif p_source_hint = 'network' then"), true);
assert.equal(migration.includes("when 'snapchat'      then 'Snapchat'"), true);

const actions = read("app/r/[propertyId]/actions.ts");
assert.equal(actions.includes("leadAttributionReferrerEnabled()"), true);
assert.equal(actions.includes("if (attributionEnabled)"), true);
assert.equal(actions.includes("leadParams.p_referrer_host"), true);
assert.equal(actions.includes("leadParams.p_utm_source"), true);

const seo = read("lib/listing-seo.ts");
assert.equal(
  seo.includes('return value === "network" ? "network" : null;'),
  true,
);

console.log("test-lead-attribution: ok");

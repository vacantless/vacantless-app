// S829g: after "Fill Marketplace for me", the card says what to do next, the
// link can be pasted right there, and coming back to the tab saves the link.
// Run: npx tsx scripts/test-s829g-marketplace-return.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
const ok = (fn: () => void) => {
  fn();
  passed++;
};
const row = readFileSync("app/dashboard/properties/[id]/marketplace-row.tsx", "utf8");
ok(() => assert.ok(row.includes("After you press Post on Facebook")));
ok(() => assert.ok(row.includes("Open your new ad on Facebook once.")));
ok(() => assert.ok(row.includes("Come back to this tab. The ad shows as live here.")));
// The old line pointed at "step 4 below", which is hidden unless step by step is open.
ok(() => assert.ok(!row.includes("paste its link in step 4 below")));
ok(() => assert.ok(row.includes('name="portal" value="facebook"') && row.includes('name="url"')));
ok(() => assert.ok(row.includes("sessionStorage.setItem(filledKey") && row.includes("sessionStorage.getItem(filledKey")));
ok(() => assert.ok((row.match(/catch \{/g) ?? []).length >= 2));
const sync = readFileSync("components/marketplace-helper-sync.tsx", "utf8");
ok(() => assert.ok(sync.includes('document.addEventListener("visibilitychange", onBack)')));
ok(() => assert.ok(sync.includes('document.removeEventListener("visibilitychange", onBack)')));
ok(() => assert.ok(/onBack = \(\) => \{\s*if \(synced && document\.visibilityState === "visible"\) post\(\{ type: "get_captured" \}\)/.test(sync)));
console.log(`test-s829g-marketplace-return: ${passed} passed`);

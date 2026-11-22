// S829e: a paid ad built and waiting at checkout reads "Pay", never "Post" again.
// Run: npx tsx scripts/test-s829e-pay-due.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { payDueByProperty, payDueLabel, type InFlightRunItem } from "../lib/rental-list-view";

let passed = 0;
const ok = (fn: () => void) => {
  fn();
  passed++;
};
const item = (over: Partial<InFlightRunItem>): InFlightRunItem => ({
  propertyId: "p1",
  channel: "kijiji",
  mode: "concierge",
  publishStatus: "needs_payment",
  approved: false,
  updatedAt: null,
  operatorActionUrl: null,
  notes: null,
  ...over,
});
// Glenrose 2026-11-22: checkout cart link saved.
ok(() => assert.deepEqual([...(payDueByProperty([item({ operatorActionUrl: "https://www.kijiji.ca/m-checkout-billing.html?cart=abc" })]).get("p1") ?? [])], ["kijiji"]));
// Manitoba: Kijiji's addToCart post page counts as built (S709).
ok(() => assert.equal(payDueByProperty([item({ operatorActionUrl: "https://www.kijiji.ca/p-post-ad.html?addToCart=true&categoryId=37" })]).get("p1")?.has("kijiji"), true));
// "I paid" pressed: still not offered as a new post while the link is saved.
ok(() => assert.equal(payDueByProperty([item({ notes: "paid_pressed_at:2026-11-22T18:46:20.675Z" })]).get("p1")?.has("kijiji"), true));
// Not built (bare post form, no link) is still a post to make.
ok(() => assert.equal(payDueByProperty([item({ operatorActionUrl: "https://www.kijiji.ca/p-post-ad.html" })]).size, 0));
ok(() => assert.equal(payDueByProperty([item({})]).size, 0));
ok(() => assert.equal(payDueByProperty([item({ publishStatus: "needs_operator", operatorActionUrl: "https://www.kijiji.ca/m-checkout-billing.html?cart=abc" })]).size, 0));
ok(() => assert.equal(payDueLabel(["kijiji"]), "Pay for Kijiji ad"));
ok(() => assert.equal(payDueLabel(["kijiji", "rentals_ca"]), "Pay for 2 ads"));
ok(() => assert.equal(payDueLabel([]), ""));
const page = readFileSync("app/dashboard/properties/page.tsx", "utf8");
ok(() => assert.ok(page.includes("!posting.has(k) && !paying.has(k)")));
ok(() => assert.ok(page.includes("{payDueLabel(v.payDueSites)}")));
const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok(() => assert.ok(actions.includes("!payDueHere.has(c)")));
console.log(`test-s829e-pay-due: ${passed} passed`);

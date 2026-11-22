// S829: approving a needs_payment post the robot never built sends it back to
// the robot, even when the saved link is only Kijiji's empty post form.
// Run: npx tsx scripts/test-s829-approve-release.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isBareSitePostForm, shouldReleaseToRobot } from "../lib/approve-release";

let passed = 0;
const ok = (fn: () => void) => {
  fn();
  passed++;
};

ok(() => assert.equal(isBareSitePostForm("https://www.kijiji.ca/p-post-ad.html"), true));
ok(() => assert.equal(isBareSitePostForm("https://www.kijiji.ca/p-post-ad.html?categoryId=37"), true));
ok(() => assert.equal(isBareSitePostForm("https://www.kijiji.ca/p-checkout.html?adId=1"), false));
ok(() => assert.equal(isBareSitePostForm(null), false));

// Glenrose 2026-11-22: needs_payment with the post form saved -> back to the robot.
ok(() => assert.equal(shouldReleaseToRobot({ publish_status: "needs_payment", operator_action_url: "https://www.kijiji.ca/p-post-ad.html" }), true));
// S784: no link at all -> back to the robot.
ok(() => assert.equal(shouldReleaseToRobot({ publish_status: "needs_payment", operator_action_url: null }), true));
// Built to a real checkout -> stays for the landlord to pay.
ok(() => assert.equal(shouldReleaseToRobot({ publish_status: "needs_payment", operator_action_url: "https://www.kijiji.ca/p-checkout.html?adId=1" }), false));
// Not a payment row -> never changed here.
ok(() => assert.equal(shouldReleaseToRobot({ publish_status: "needs_operator", operator_action_url: null }), false));

const src = readFileSync("app/dashboard/properties/distribution-actions.ts", "utf8");
ok(() => assert.ok(src.includes("const releaseToRobot = pendingItem ? shouldReleaseToRobot(pendingItem) : false;")));
ok(() => assert.ok(src.includes('{ publish_status: "needs_operator", operator_action_url: null }')));
ok(() => assert.ok(!src.includes('pendingItem?.publish_status === "needs_payment" && !pendingItem.operator_action_url')));

console.log(`test-s829-approve-release: ${passed} passed`);

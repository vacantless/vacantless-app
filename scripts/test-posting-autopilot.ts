// S754: the standing posting setting approves only a free robot ad at
// needs_operator, for an org with Posting, with the setting on.
import assert from "node:assert/strict";
import { standingApprovalApplies, standingApprovalAudit } from "../lib/posting-autopilot";

const base = { gate: "needs_operator", channel: "kijiji", autopilot: true, addonAllowed: true };
assert.equal(standingApprovalApplies(base), true, "free Kijiji ad, setting on");
assert.equal(standingApprovalApplies({ ...base, channel: "rentals_ca" }), true);
assert.equal(standingApprovalApplies({ ...base, channel: "zumper" }), true);
assert.equal(standingApprovalApplies({ ...base, gate: "needs_payment" }), false, "money never passes");
assert.equal(standingApprovalApplies({ ...base, gate: "needs_login" }), false);
assert.equal(standingApprovalApplies({ ...base, autopilot: false }), false, "setting off");
assert.equal(standingApprovalApplies({ ...base, autopilot: null }), false, "unknown reads as off");
assert.equal(standingApprovalApplies({ ...base, addonAllowed: false }), false, "no Posting add-on");
assert.equal(standingApprovalApplies({ ...base, channel: "facebook_feed" }), false, "API sites have their own consent");
assert.equal(standingApprovalApplies({ ...base, channel: "viewit" }), false, "paid sites are not robot lanes");
assert.match(standingApprovalAudit("Kijiji"), /Kijiji/);
assert.doesNotMatch(standingApprovalAudit("Kijiji"), /—/, "no em dash");
console.log("PASS test-posting-autopilot (11 checks)");

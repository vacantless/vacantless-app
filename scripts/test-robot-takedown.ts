// S754: which live ads the robot takes down when a rental leaves the market.
import assert from "node:assert/strict";
import { robotTakedownTargets, robotTakedownAudit } from "../lib/robot-takedown";

const posts = [
  { id: "k", portal: "kijiji", status: "live", url: "https://www.kijiji.ca/v-apartments/1" },
  { id: "r", portal: "rentals_ca", status: "live", url: "https://rentals.ca/windsor-on/x" },
  { id: "z", portal: "zumper", status: "live", url: "https://www.zumper.com/listings/65446440b" },
  { id: "f", portal: "facebook", status: "live", url: "https://www.facebook.com/marketplace/item/1/" },
  { id: "p", portal: "facebook_feed", status: "live", url: "https://www.facebook.com/2" },
  { id: "old", portal: "kijiji", status: "removed", url: "https://www.kijiji.ca/v-apartments/0" },
  { id: "nourl", portal: "zumper", status: "live", url: null },
];
const t = robotTakedownTargets({ posts, aliveChannels: ["kijiji", "zumper"], postingAllowed: true });
assert.deepEqual(t.map((x) => x.id), ["k", "z"], "robot sites with an alive sign-in and a link; Marketplace and the Page are not the robot's");
assert.deepEqual(robotTakedownTargets({ posts, aliveChannels: ["kijiji"], postingAllowed: false }), [], "no Posting, no robot takedown");
assert.deepEqual(robotTakedownTargets({ posts, aliveChannels: [], postingAllowed: true }), [], "signed out everywhere");
assert.match(robotTakedownAudit("rentals_ca"), /Rentals\.ca/);
assert.doesNotMatch(robotTakedownAudit("kijiji"), /—/);
console.log("PASS test-robot-takedown (5 checks)");

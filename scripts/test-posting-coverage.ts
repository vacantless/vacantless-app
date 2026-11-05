// S754: posting coverage, the rentals-by-sites rule behind the gap card and
// the health email line. Pure.
import assert from "node:assert/strict";
import { postingCoverage, offeredSites, coverageLine, coverageHealthLines, shortAddress } from "../lib/posting-coverage";

const sessions = [
  { channel: "kijiji", alive: true },
  { channel: "zumper", alive: true },
  { channel: "rentals_ca", alive: false },
];
const properties = [
  { id: "a", address: "833 Pillette Rd, Unit 33, Windsor, ON N8Y 3B4", status: "available" },
  { id: "b", address: "1551 Assumption St, Unit 9, Windsor, ON N9A 3E2", status: "available" },
  { id: "c", address: "1195 Bruce Ave, Unit 303, Windsor, ON", status: "leased" },
];
const posts = [
  { propertyId: "a", portal: "facebook", status: "live" },
  { propertyId: "b", portal: "facebook", status: "live" },
  { propertyId: "b", portal: "kijiji", status: "live" },
  { propertyId: "b", portal: "zumper", status: "live" },
  { propertyId: "b", portal: "rentals_ca", status: "live" },
  { propertyId: "a", portal: "kijiji", status: "removed" },
  { propertyId: "c", portal: "facebook", status: "live" },
];

assert.deepEqual(offeredSites({ sessions, postingAddon: true }), ["facebook", "kijiji", "zumper"], "Marketplace always; robot sites only when signed in");
assert.deepEqual(offeredSites({ sessions, postingAddon: false }), ["facebook"], "no Posting: Marketplace only");
assert.deepEqual(offeredSites({ sessions: [...sessions, { channel: "facebook_feed", alive: true }], postingAddon: false }), ["facebook", "facebook_feed"]);

const cov = postingCoverage({ properties, posts, sessions, postingAddon: true });
assert.equal(cov.rows.length, 2, "leased rentals are not rows");
const a = cov.rows.find((r) => r.propertyId === "a")!;
assert.deepEqual(a.live, ["facebook"]);
assert.deepEqual(a.missing, ["kijiji", "zumper"], "a removed ad is not live");
assert.deepEqual(a.missingRobot, ["kijiji", "zumper"]);
assert.equal(a.offered, 3);
const b = cov.rows.find((r) => r.propertyId === "b")!;
assert.deepEqual(b.missing, [], "a live ad on a site the org is not signed in to still counts as live");
assert.equal(cov.gaps, 1);
assert.deepEqual(cov.signInToAdd, ["rentals_ca"]);

assert.equal(shortAddress("833 Pillette Rd, Unit 33, Windsor, ON N8Y 3B4"), "833 Pillette Rd, Unit 33");
assert.equal(shortAddress("1195 Bruce Ave, Windsor, ON"), "1195 Bruce Ave");
assert.equal(shortAddress(null), "A rental");
assert.equal(coverageLine(a, shortAddress), "833 Pillette Rd, Unit 33 is on 1 of 3 sites. Missing: Kijiji, Zumper.");
const lines = coverageHealthLines("Agile", cov);
assert.equal(lines.length, 1);
assert.match(lines[0], /^Agile: 833 Pillette Rd, Unit 33, Windsor, ON N8Y 3B4 is on 1 of 3 sites/);

// cap
const many = postingCoverage({
  properties: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, address: `${i} Main St`, status: "available" })),
  posts: [],
  sessions,
  postingAddon: true,
});
const capped = coverageHealthLines("Org", many, 6);
assert.equal(capped.length, 7);
assert.match(capped[6], /3 more rentals with missing sites/);
assert.ok(!capped.join(" ").includes("—"), "no em dash");
console.log("PASS test-posting-coverage (20 checks)");

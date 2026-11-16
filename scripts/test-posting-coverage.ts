// S754: posting coverage, the rentals-by-sites rule behind the gap card and
// the health email line. Pure.
import assert from "node:assert/strict";
import { postingCoverage, offeredSites, coverageLine, coverageHealthLines, shortAddress, joinOr, optionalSiteReason } from "../lib/posting-coverage";

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
const lines = coverageHealthLines(cov);
assert.equal(lines.length, 1);
// S769: short address, no account name, "not on X or Y".
assert.equal(lines[0], "833 Pillette Rd, Unit 33: not on Kijiji or Zumper");
assert.equal(joinOr(["Kijiji"]), "Kijiji");
assert.equal(joinOr(["Kijiji", "Zumper", "Rentals.ca"]), "Kijiji, Zumper or Rentals.ca");

// cap
const many = postingCoverage({
  properties: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, address: `${i} Main St`, status: "available" })),
  posts: [],
  sessions,
  postingAddon: true,
});
const capped = coverageHealthLines(many, 6);
assert.equal(capped.length, 7);
assert.equal(capped[6], "3 more rentals like this.");
assert.ok(!capped.join(" ").includes("—"), "no em dash");
// S805: a paid ad or a full free limit is the landlord's choice, not a gap.
assert.equal(optionalSiteReason("kijiji", { cost: { key: "kijijiPerAd" }, capReached: false }), "fee", "business Kijiji: every ad is paid");
assert.equal(optionalSiteReason("kijiji", { cost: { key: "kijijiPerExtraAd" }, capReached: true }), "fee", "personal Kijiji with the free ad used");
assert.equal(optionalSiteReason("kijiji", { cost: { key: "kijijiNext" }, capReached: false }), null, "personal Kijiji with the free ad open is a real gap");
assert.equal(optionalSiteReason("kijiji", { cost: { key: "kijijiTierUnknown" }, capReached: false }), null);
assert.equal(optionalSiteReason("rentals_ca", { cost: { key: "free" }, capReached: true }), "full");
assert.equal(optionalSiteReason("zumper", { cost: { key: "free" }, capReached: false }), null);
assert.equal(optionalSiteReason("facebook", { cost: { key: "free" }, capReached: true }), null, "Marketplace is never optional");
assert.equal(optionalSiteReason("kijiji", null), null);
const allIn = [
  { channel: "kijiji", alive: true },
  { channel: "zumper", alive: true },
  { channel: "rentals_ca", alive: true },
];
const choice = postingCoverage({
  properties,
  posts,
  sessions: allIn,
  postingAddon: true,
  optional: new Map([["kijiji", "fee"], ["rentals_ca", "full"]]),
});
const ca = choice.rows.find((r) => r.propertyId === "a")!;
assert.deepEqual(ca.missing, ["zumper"], "only the free, open site is missing");
assert.deepEqual(ca.missingRobot, ["zumper"], "the main button never offers a paid or full site");
assert.deepEqual(ca.optional, [{ channel: "kijiji", reason: "fee" }, { channel: "rentals_ca", reason: "full" }]);
const cb = choice.rows.find((r) => r.propertyId === "b")!;
assert.deepEqual(cb.optional, [], "a site with a live ad is not listed as a choice");
assert.equal(choice.gaps, 1);
const onlyChoice = postingCoverage({
  properties,
  posts: [...posts, { propertyId: "a", portal: "zumper", status: "live" }],
  sessions: allIn,
  postingAddon: true,
  optional: new Map([["kijiji", "fee"], ["rentals_ca", "full"]]),
});
assert.equal(onlyChoice.gaps, 0, "a rental on every free site reads as done");
assert.deepEqual(coverageHealthLines(onlyChoice), [], "the health email stops repeating a paid site");
assert.deepEqual(cov.rows[0].optional, [], "no optional map: nothing is a choice");
console.log("PASS test-posting-coverage (38 checks)");

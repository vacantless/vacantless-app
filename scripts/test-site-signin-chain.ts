// Unit tests for the one-sitting sign-in chain (S735, review item 7).
// Run: npx tsx scripts/test-site-signin-chain.ts
import assert from "node:assert/strict";
import {
  buildSigninChain,
  nextSigninChannel,
  signinChainSummary,
  signinNeeded,
} from "../lib/site-signin";

assert.equal(signinNeeded("not_linked"), true);
assert.equal(signinNeeded("dead_session"), true);
assert.equal(signinNeeded("connected"), false);
assert.equal(signinNeeded("checking"), false);
assert.equal(signinNeeded(null), false);

const all = buildSigninChain({ kijiji: "not_linked", rentals_ca: "not_linked", zumper: "not_linked" });
assert.deepEqual(all.map((s) => s.channel), ["kijiji", "rentals_ca", "zumper"]);
assert.equal(nextSigninChannel(all, null), "kijiji");
assert.equal(nextSigninChannel(all, "kijiji"), "rentals_ca");
assert.equal(nextSigninChannel(all, "zumper"), null);
assert.equal(signinChainSummary(all), "Sign in to 3 sites, one after the other. About 6 minutes.");

const some = buildSigninChain({ kijiji: "connected", rentals_ca: "not_linked", zumper: "dead_session" });
assert.equal(nextSigninChannel(some, null), "rentals_ca");
assert.equal(nextSigninChannel(some, "rentals_ca"), "zumper");
assert.equal(signinChainSummary(some), "2 of 3 sites still need a sign-in.");

const done = buildSigninChain({ kijiji: "connected", rentals_ca: "connected", zumper: "connected" });
assert.equal(nextSigninChannel(done, null), null);
assert.match(signinChainSummary(done), /signed in to every site/);

const hidden = buildSigninChain({ kijiji: "not_linked", rentals_ca: "not_linked", zumper: "not_linked" }, (c) => c === "rentals_ca");
assert.equal(hidden.find((s) => s.channel === "rentals_ca")?.state, "off");
assert.equal(nextSigninChannel(hidden, "kijiji"), "zumper");
assert.equal(signinChainSummary(hidden), "Sign in to 2 sites, one after the other. About 4 minutes.");

console.log("test-site-signin-chain: all passed");

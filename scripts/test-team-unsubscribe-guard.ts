import assert from "node:assert/strict";
import { buildTeamAddressSet, teamAddressesToUnblock } from "../lib/team-unsubscribe-guard";

const team = buildTeamAddressSet([
  [" Rentals@AgileOnline.ca ", null, "noam@royallepage.ca"],
  ["thadmusco@gmail.com", "not-an-email", undefined],
]);
assert.equal(team.size, 3);

const out = teamAddressesToUnblock(
  [
    { email: "rentals@agileonline.ca", reason: { code: "unsubscribedViaEmail" } },
    { email: "RENTALS@agileonline.ca", reason: { code: "unsubscribedViaEmail" } }, // dupe
    { email: "renter@example.com", reason: { code: "unsubscribedViaEmail" } }, // renter: stays
    { email: "noam@royallepage.ca", reason: { code: "hardBounce" } }, // bounce: stays
    { email: "thadmusco@gmail.com", reason: { code: "contactFlaggedAsSpam" } }, // spam: stays
    { email: "thadmusco@gmail.com", reason: { code: "adminBlocked" } }, // admin: stays
  ],
  team,
);
assert.deepEqual(out, ["rentals@agileonline.ca"]);
assert.deepEqual(
  teamAddressesToUnblock([{ email: "noam@royallepage.ca", reason: { code: "unsubscribedViaApi" } }], team),
  ["noam@royallepage.ca"],
);
assert.deepEqual(teamAddressesToUnblock([{ email: "x@y.z" }], team), []);
console.log("team-unsubscribe-guard: all checks passed");

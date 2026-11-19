// S820d: own-form accounts (Agile on Buildium) get the free LTB check and no
// dead Offer box. S820e: marking a unit Rented marks the renter with the accepted offer Leased.
// Run: npx tsx scripts/test-s820de-own-form-lease-winner.ts
import { readFileSync } from "node:fs";
import { pickLeaseWinner } from "../lib/lease-winner";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${name}`, extra === undefined ? "" : JSON.stringify(extra));
  }
}
const c = (id: string, status: string, acceptedOffer = false) => ({ id, status, acceptedOffer });

ok("accepted offer -> them", pickLeaseWinner([c("a", "applied", true), c("b", "showed")]) === "a");
ok("sent an application only -> nobody (could be the wrong person)", pickLeaseWinner([c("a", "showed"), c("b", "replied")]) === null);
ok("two accepted offers -> nobody", pickLeaseWinner([c("a", "applied", true), c("b", "applied", true)]) === null);
ok("lost with an offer ignored", pickLeaseWinner([c("a", "lost", true), c("b", "applied", true)]) === "b");
ok("already leased -> nobody new", pickLeaseWinner([c("a", "leased", true)]) === null);
ok("empty -> nobody", pickLeaseWinner([]) === null);

const up = readFileSync("lib/unit-progress-server.ts", "utf8");
ok("Rented tap marks the winner first", up.indexOf("markLeaseWinner({") > 0 && up.indexOf("markLeaseWinner({") < up.indexOf("notifyWaitingRentersRented({"));
const pa = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok("Leased save marks the winner before the rented notice", pa.indexOf("await markLeaseWinner({") > 0 && pa.indexOf("await markLeaseWinner({") < pa.indexOf("await notifyWaitingRentersRented({"));

const card = readFileSync("app/dashboard/leads/[id]/application-card.tsx", "utf8");
const ownBlock = card.slice(card.indexOf("open.length === 0 && p.ownForm"), card.indexOf(") : open.length === 0 ? ("));
ok("own form shows Check LTB orders", ownBlock.includes("Check LTB orders (free)") && ownBlock.includes("ltbSearchUrl(p.lead.name)"));
ok("offer hidden for own form with nothing signed", card.includes("{p.ownForm && signed.length === 0 && !offer ? null : ("));

console.log(`S820d+e own form and lease winner: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

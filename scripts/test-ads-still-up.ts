// S723: tests for lib/ads-still-up.ts. Run: npx tsx scripts/test-ads-still-up.ts
import { rentalsCaCapNote, adsListText, adsStillUp, isUnavailableStatus, siteName, statusPhrase, stillUpNoticeVars, takenDownNote } from "../lib/ads-still-up";
import { getNotificationEvent, renderNotification } from "../lib/notifications";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, x?: unknown) => (c ? pass++ : (fail++, console.log("FAIL:", n, x ?? "")));

ok("leased unavailable", isUnavailableStatus("leased"));
ok("off_market unavailable", isUnavailableStatus("off_market"));
ok("paused unavailable", isUnavailableStatus("paused"));
ok("available is not", !isUnavailableStatus("available"));
ok("draft is not", !isUnavailableStatus("draft"));
ok("null is not", !isUnavailableStatus(null));

const posts = [
  { id: "1", portal: "kijiji", url: "https://kijiji.ca/v-x/1", status: "live" },
  { id: "2", portal: "zumper", url: "https://zumper.com/l/2", status: "removed" },
  { id: "3", portal: "facebook", url: " ", status: "live" },
  { id: "4", portal: "rentals_ca", url: "https://rentals.ca/x", status: "live" },
  { id: "5", portal: "zumper", url: null, status: "live" },
  { id: "6", portal: "facebook", url: "https://facebook.com/marketplace/item/6", status: "expired" },
];
const up = adsStillUp(posts);
ok("only live with link", up.map((p) => p.id).join(",") === "1,4", up);
ok("empty input", adsStillUp(null).length === 0);

ok("site names", siteName("rentals_ca") === "Rentals.ca" && siteName("facebook") === "Facebook Marketplace" && siteName("weird_site") === "weird site");
ok("phrase leased", statusPhrase("leased", false) === "is leased");
ok("phrase archived", statusPhrase("available", true) === "is off the market");
ok("phrase paused", statusPhrase("paused", false) === "is paused");

const list = adsListText(up);
ok("list lines", list.startsWith("- Kijiji: https://kijiji.ca/v-x/1\n- Rentals.ca: https://rentals.ca/x"), list);
ok("kijiji note", list.includes("Paid for the Kijiji ad?"));
ok("no kijiji note without kijiji", !adsListText([up[1]]).includes("Kijiji ad"));

const vars = stillUpNoticeVars({ orgName: "Acme", address: "1 Main St", status: "leased", archived: false, posts: up, dashboardUrl: "https://app.vacantless.com/dashboard/properties/p#ads-still-up" });
ok("count words", vars.ad_count === "2 ads");
ok("one ad", stillUpNoticeVars({ orgName: null, address: null, status: "off_market", archived: false, posts: [up[0]], dashboardUrl: "u" }).ad_count === "1 ad");

// The registered event renders cleanly with these vars.
const ev = getNotificationEvent("leasing.ads_still_up");
ok("event registered", !!ev && ev.active && ev.audience === "operator");
if (ev) {
  const { subject, body } = renderNotification(ev, null, vars);
  ok("subject", subject === "Take down 2 ads: 1 Main St is leased", subject);
  ok("body has links", body.includes("- Kijiji: https://kijiji.ca/v-x/1") && body.includes("Open the rental: https://app.vacantless.com"), body);
  ok("no leftover tokens", !/\{\{/.test(subject + body));
  ok("no em dash", !/—/.test(subject + body + ev.description + ev.label));
}

const note = takenDownNote("old note", "a@b.com", new Date("2026-10-19T15:00:00Z"));
ok("note appended", note === "old note\nTaken down by a@b.com on 2026-10-19 (marked in Vacantless).", note);
ok("note fresh", takenDownNote(null, null, new Date("2026-10-19T15:00:00Z")).startsWith("Taken down by the landlord"));

ok("cap under 3 silent", rentalsCaCapNote(2) === null && rentalsCaCapNote(0) === null);
ok("cap at 3 warns", (rentalsCaCapNote(3) ?? "").startsWith("You already have 3 ads live on Rentals.ca."));
ok("cap no em dash", !/\u2014/.test(rentalsCaCapNote(4) ?? ""));

console.log(`ads-still-up: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

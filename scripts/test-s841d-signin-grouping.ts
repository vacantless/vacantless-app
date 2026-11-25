// S841d (REVIEW-S841-SIGNIN-GROUPING): ask for a site sign-in only when work
// is waiting there, check the other sites before the one message, and name a
// site that is due to sign out soon. Run: npx tsx scripts/test-s841d-signin-grouping.ts
import { readFileSync } from "node:fs";
import {
  dueSoonLine,
  lastRenewedOn,
  recheckDecision,
  signinDueSoon,
  siteWorkPhrase,
  siteWorkWaiting,
} from "../lib/site-work-waiting";
import { joinAnd, signinLostGroupEmail } from "../lib/signin-lost";
import { needsYouNotices } from "../lib/needs-you";
import { buildSigninChain, nextSigninChannel } from "../lib/site-signin";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`, extra ?? "");
  }
}

const NOW = "2026-11-24T23:30:00Z";
const TODAY = "2026-11-24";
const props = [
  { id: "p1", status: "available", archived: false },
  { id: "p2", status: "leased", archived: false },
  { id: "p3", status: "available", archived: true },
];
const w = (o: Partial<Parameters<typeof siteWorkWaiting>[0]>) =>
  siteWorkWaiting({ channel: "rentals_ca", properties: props, posts: [], items: [], today: TODAY, nowISO: NOW, ...o });
const post = (propertyId: string, postedOn: string, portal = "rentals_ca", notes: string | null = null) => ({
  propertyId,
  portal,
  status: "live",
  postedOn,
  notes,
});

// 1. Work waiting.
ok("nothing live, nothing queued: nothing waits", w({}).waiting === false);
ok("a fresh live ad on an available rental: nothing waits", w({ posts: [post("p1", "2026-11-20")] }).waiting === false);
ok("day 16 of a free Rentals.ca ad: not yet", w({ posts: [post("p1", "2026-11-08")] }).waiting === false);
ok("day 17: renewal is due", w({ posts: [post("p1", "2026-11-07")] }).reasons.includes("renewal"));
ok("a renewal note moves the clock", w({ posts: [post("p1", "2026-10-01", "rentals_ca", "2026-11-20 free plan renewed by the home live check")] }).waiting === false);
ok("lastRenewedOn reads the later note", lastRenewedOn("2026-10-01", "x | 2026-11-20 free plan renewed") === "2026-11-20");
ok("renewal is a Rentals.ca thing only", w({ channel: "zumper", posts: [post("p1", "2026-10-01", "zumper")] }).waiting === false);
ok("a live ad on a rented rental waits to come down", w({ posts: [post("p2", "2026-11-20")] }).reasons.includes("takedown"));
ok("a live ad on an archived rental waits to come down", w({ posts: [post("p3", "2026-11-20")] }).reasons.includes("takedown"));
ok("a rented rental's old ad is not renewed", !w({ posts: [post("p2", "2026-10-01")] }).reasons.includes("renewal"));
ok("another site's ad is not this site's work", w({ posts: [post("p2", "2026-11-20", "zumper")] }).waiting === false);
const item = (publishStatus: string, updatedAt: string | null, status = "in_progress", channel = "rentals_ca") => ({ channel, publishStatus, status, updatedAt });
ok("a queued job waits", w({ items: [item("queued", "2026-11-24T20:00:00Z")] }).reasons.includes("queued_job"));
ok("a job parked at needs_login waits", w({ items: [item("needs_login", "2026-11-20T20:00:00Z")] }).waiting);
ok("a job waiting for approval counts (lean toward asking)", w({ items: [item("needs_operator", "2026-11-23T20:00:00Z")] }).waiting);
ok("a skipped or rejected job is history", w({ items: [item("skipped", NOW), item("rejected", NOW)] }).waiting === false);
ok("a done item is history", w({ items: [item("queued", NOW, "done")] }).waiting === false);
ok("a job older than two weeks is stale", w({ items: [item("needs_login", "2026-10-27T12:00:00Z")] }).waiting === false);
ok("another site's job is not this site's work", w({ items: [item("queued", NOW, "in_progress", "kijiji")] }).waiting === false);
ok("phrase names both", siteWorkPhrase({ waiting: true, reasons: ["queued_job", "renewal"] }) === "an ad is waiting to go up or change, and a free ad is due to be renewed");

// 2. One check, one ask. Today's case: Zumper found out 15:54, Rentals.ca last looked at the day before.
const zumperFound = "2026-11-24T20:54:00Z";
const stale = { channel: "rentals_ca", alive: true, lastCheckedAt: "2026-11-23T14:20:00Z", checkRequestedAt: "2026-11-16T20:35:00Z" };
const first = recheckDecision({ lostCheckedAt: zumperFound, others: [stale], nowISO: "2026-11-24T21:00:00Z" });
ok("a site not looked at since is checked first, and the email waits", first.request.join() === "rentals_ca" && first.hold);
const asked = { ...stale, checkRequestedAt: "2026-11-24T21:00:00Z" };
const second = recheckDecision({ lostCheckedAt: zumperFound, others: [asked], nowISO: "2026-11-24T21:15:00Z" });
ok("asked and not answered yet: wait, do not ask twice", second.request.length === 0 && second.hold);
const third = recheckDecision({ lostCheckedAt: zumperFound, others: [asked], nowISO: "2026-11-24T21:31:00Z" });
ok("a sleeping computer never answers: go after 30 minutes", third.request.length === 0 && !third.hold);
const answered = { ...asked, lastCheckedAt: "2026-11-24T21:10:00Z" };
ok("answered: go", !recheckDecision({ lostCheckedAt: zumperFound, others: [answered], nowISO: "2026-11-24T21:15:00Z" }).hold);
ok("a site looked at in the same hour needs no second look", !recheckDecision({ lostCheckedAt: zumperFound, others: [{ ...stale, lastCheckedAt: "2026-11-24T20:53:00Z" }], nowISO: NOW }).hold);
ok("a site already signed out is not checked", !recheckDecision({ lostCheckedAt: zumperFound, others: [{ ...stale, alive: false }], nowISO: NOW }).hold);
ok("a site never signed in is not checked", !recheckDecision({ lostCheckedAt: zumperFound, others: [{ ...stale, alive: null }], nowISO: NOW }).hold);
ok("no check time, no hold", !recheckDecision({ lostCheckedAt: null, others: [stale], nowISO: NOW }).hold);

// 3. Due soon.
const soon = (channel: string, signedInAt: string, alive: boolean | null = true) => signinDueSoon({ channel, alive, signedInAt, nowISO: NOW });
ok("Zumper at 12 of 15 days is due soon", soon("zumper", "2026-11-12T23:30:00Z").soon);
ok("Zumper at 5 days is not", !soon("zumper", "2026-11-19T23:30:00Z").soon);
ok("Rentals.ca at 2 days is not (too short to be worth it)", !soon("rentals_ca", "2026-11-22T23:30:00Z").soon);
ok("Rentals.ca past 2.5 days has probably ended", soon("rentals_ca", "2026-11-21T19:34:00Z").soon);
ok("Kijiji is never due soon", !soon("kijiji", "2026-08-13T15:24:00Z").soon);
ok("a signed-out site is not 'due soon'", !soon("zumper", "2026-11-01T00:00:00Z", false).soon);
ok("line for a long sign-in", dueSoonLine("Zumper", 12.2, 15) === "Zumper still works, but it is 12 days into a sign-in that usually lasts about 15.");
ok("line for a short one past its life", dueSoonLine("Rentals.ca", 3.2, 2.5).startsWith("Rentals.ca has probably signed out by now: it is 3 days since you signed in"));

// The one email.
ok("joinAnd", joinAnd(["A"]) === "A" && joinAnd(["A", "B"]) === "A and B" && joinAnd(["A", "B", "C"]) === "A, B and C");
const one = signinLostGroupEmail({ orgName: "Lakeview Rentals", sites: [{ label: "Zumper", waiting: "an ad is waiting to go up or change" }] });
ok("one site: subject and button", one.subject === "Sign in to Zumper again" && one.actionLabel === "Sign in to Zumper");
ok("one site: says what waits", one.body.includes("On Zumper, an ad is waiting to go up or change. That waits until you sign in."));
const two = signinLostGroupEmail({
  orgName: null,
  sites: [
    { label: "Rentals.ca", waiting: "a free ad is due to be renewed" },
    { label: "Zumper", waiting: "an ad is waiting to go up or change" },
  ],
  canWait: ["Kijiji"],
  dueSoon: [],
});
ok("two sites: one subject", two.subject === "Sign in to Rentals.ca and Zumper again");
ok("two sites: one sitting", two.actionLabel === "Sign in to Rentals.ca first" && two.body.includes("one after the other"));
ok("a site with nothing waiting is named as able to wait", two.body.includes("Kijiji signed out too, but nothing is waiting there and your ads stay up."));
ok("without a name", two.body.startsWith("Rentals.ca and Zumper signed your account out."));
const withSoon = signinLostGroupEmail({ orgName: "A", sites: [{ label: "Rentals.ca", waiting: "x" }], dueSoon: [dueSoonLine("Zumper", 12, 15)] });
ok("due soon makes it a sitting", withSoon.actionLabel === "Sign in to Rentals.ca first" && withSoon.body.includes("Worth doing in the same sitting:"));
ok("no em dash", !/[—–]/.test(one.subject + one.body + two.body + withSoon.body));

// Today's card.
const tiles = { zumper: "dead_session", rentals_ca: "dead_session", kijiji: "linked" };
ok("both cards without the rule", needsYouNotices({ postingAllowed: true, tileStateByChannel: tiles }).length === 2);
const quietRentals = needsYouNotices({ postingAllowed: true, tileStateByChannel: tiles, nothingWaiting: (c) => c === "rentals_ca" });
ok("a signed-out site with nothing waiting gets no card", quietRentals.length === 1 && quietRentals[0].channel === "zumper");

// The sitting.
const chain = buildSigninChain({ kijiji: "linked", rentals_ca: "dead_session", zumper: "linked" }, () => false, ["zumper"]);
ok("a due-soon site joins the sitting", chain.find((s) => s.channel === "zumper")?.state === "todo" && chain.find((s) => s.channel === "zumper")?.soon === true);
ok("it comes after the signed-out one", nextSigninChannel(chain, "rentals_ca") === "zumper");
ok("without it the chain is as before", buildSigninChain({ kijiji: "linked", rentals_ca: "dead_session", zumper: "linked" }).find((s) => s.channel === "zumper")?.state === "done");

// Wiring.
const route = readFileSync("app/api/cron/signin-lost/route.ts", "utf8");
ok("sweep asks what is waiting", route.includes("loadSiteWork(admin, orgId"));
ok("nothing waiting: held, and no stamp", route.includes('"held_nothing_waiting"'));
ok("sweep checks the other sites first", route.includes("recheckDecision(") && route.includes("requestSessionCheck(") && route.includes("triggerRentalsTakedown()") && route.includes("triggerSessionCheck(orgId, cloud)"));
ok("held while the others are checked", route.indexOf("if (recheck.hold)") > 0 && route.indexOf("if (recheck.hold)") < route.indexOf("signinLostGroupEmail("));
ok("several sites open as one sitting", route.includes('withQuery(siteSigninOpenHref(first), "chain", "1")'));
ok("one text for the sites", route.includes("joinAnd(claimed.map("));
const today = readFileSync("app/dashboard/page.tsx", "utf8");
ok("Today asks only when a site is signed out", today.includes("robotAccess.setup && anySiteSignedOut ? await loadSiteWork("));
ok("Today passes the rule to the cards", today.includes("nothingWaiting:"));
const server = readFileSync("lib/site-work-waiting-server.ts", "utf8");
ok("reads live ads and open jobs only", server.includes('.eq("status", "live")') && server.includes('"needs_login"'));
ok("sign-in pages carry due-soon sites", readFileSync("app/dashboard/site-signin/page.tsx", "utf8").includes("loadDueSoonSites(") && readFileSync("app/dashboard/site-signin/[channel]/page.tsx", "utf8").includes("loadDueSoonSites("));

// S841e: a finished sign-in starts the site's other waiting work at once.
const act = readFileSync("app/dashboard/site-signin/[channel]/actions.ts", "utf8");
ok("a finished sign-in still starts posts", act.includes("void triggerPostNow();"));
ok("and the site's renewals, edits and takedowns", act.includes("signinOpensAtHome(ch) ? triggerRentalsTakedown() : triggerTakedownNow()"));
ok("the window read knows its site", act.includes("expires_at, updated_at, channel"));

console.log(`s841d signin grouping: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

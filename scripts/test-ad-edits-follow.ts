// Run with: npx tsx scripts/test-ad-edits-follow.ts
// S761 (REVIEW-S761 item 2): an edit to a live rental reaches the ads.
import { readFileSync } from "node:fs";
import {
  adDetailsChanged,
  adUpdateNotice,
  adUpdatePlan,
  adUpdatePlanFromParam,
  isUpdateRepost,
  updateRepostDecision,
  updateRepostNote,
  updateTakedownAudit,
  updateRepostAudit,
} from "../lib/ad-edits-follow";
import { SWEEP_PATHS } from "../lib/cron-sweeps";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

// 1. Change detection: only the fields the ads show, in a fixed order, as labels.
const before = { rent_cents: 145000, description: "Bright 2 bed", available_date: "2026-12-01", beds: 2, baths: 1, parking: "1 spot" };
ok("no change", adDetailsChanged(before, { ...before }).length === 0);
ok("rent change", adDetailsChanged(before, { ...before, rent_cents: 150000 }).join() === "rent");
ok("two changes in order", adDetailsChanged(before, { ...before, parking: null, description: "Bright 2 bed, new floors" }).join() === "description,parking");
ok("null vs empty is no change", adDetailsChanged({ ...before, parking: null }, { ...before, parking: "" }).length === 0);
ok("number vs string is no change", adDetailsChanged({ ...before, beds: 2 }, { ...before, beds: "2" }).length === 0);

// 2. The plan: free robot sites re-post, Kijiji and Marketplace are the landlord's.
const posts = [
  { id: "a", portal: "rentals_ca", status: "live", url: "https://rentals.ca/x" },
  { id: "b", portal: "zumper", status: "live", url: "https://zumper.com/x" },
  { id: "c", portal: "kijiji", status: "live", url: "https://kijiji.ca/x" },
  { id: "d", portal: "facebook", status: "live", url: "https://facebook.com/x" },
  { id: "e", portal: "facebook_feed", status: "live", url: "https://facebook.com/page" },
  { id: "f", portal: "zumper", status: "removed", url: "https://zumper.com/old" },
];
const base = { posts, aliveChannels: ["rentals_ca", "zumper", "kijiji"], postingAllowed: true, autopilot: true as boolean | null };
const plan = adUpdatePlan(base);
ok("free sites re-post", plan.repost.join() === "rentals_ca,zumper");
ok("Kijiji and Marketplace by hand, with the ad link", plan.byHand.map((b) => b.portal).join() === "kijiji,facebook" && plan.byHand[0].url === "https://kijiji.ca/x");
ok("the Page post is neither (API)", !plan.byHand.some((b) => b.portal === "facebook_feed"));
ok("a removed ad is ignored", !plan.repost.includes("zumper") || plan.repost.filter((p) => p === "zumper").length === 1);
ok("signed-out site falls to by hand", adUpdatePlan({ ...base, aliveChannels: ["rentals_ca"] }).byHand.some((b) => b.portal === "zumper"));
ok("no Posting: everything by hand", adUpdatePlan({ ...base, postingAllowed: false }).repost.length === 0);
ok("setting off: everything by hand", adUpdatePlan({ ...base, autopilot: false }).repost.length === 0);

// 3. The mark and the sweep's decision.
const note = updateRepostNote("2026-11-07T14:00:00.000Z", ["rent", "parking"]);
ok("note carries the mark and the change", isUpdateRepost(note) && /rent, parking/.test(note) && note.startsWith("2026-11-07"));
const d = (over: Partial<Parameters<typeof updateRepostDecision>[0]>) =>
  updateRepostDecision({ transport: "takedown", publishStatus: "skipped", notes: note, propertyStatus: "available", propertyArchived: false, postingAllowed: true, autopilot: true, sessionAlive: true, ...over });
ok("done takedown re-posts", d({}) === "repost");
ok("takedown still queued waits", d({ publishStatus: "queued" }) === "wait" && d({ publishStatus: "submitting" }) === "wait");
ok("a takedown that failed is dropped", d({ publishStatus: "needs_operator" }) === "drop");
ok("rental no longer live is dropped", d({ propertyStatus: "leased" }) === "drop");
ok("archived is dropped", d({ propertyArchived: true }) === "drop");
ok("no mark is dropped", d({ notes: "lease-up takedown" }) === "drop");
ok("signed out is dropped", d({ sessionAlive: false }) === "drop");
ok("not a takedown is dropped", d({ transport: null }) === "drop");

// 4. Words.
ok("takedown audit says updating", /Updating your Rentals\.ca ad/.test(updateTakedownAudit("rentals_ca")));
ok("repost audit says updated", /updated Zumper ad/.test(updateRepostAudit("zumper")));
const notice = adUpdateNotice(plan);
ok("notice names both kinds", /Rentals\.ca and Zumper: we are updating your ad\./.test(notice ?? "") && /Kijiji still shows the old details/.test(notice ?? ""));
ok("no notice when nothing is up", adUpdateNotice({ repost: [], byHand: [] }) === null);
ok("no dash, no mechanism", !/—|robot|worker/i.test(`${notice} ${updateTakedownAudit("zumper")} ${updateRepostAudit("zumper")}`));
const round = adUpdatePlanFromParam("rentals_ca,zumper,hand:kijiji");
ok("param round-trips", round.repost.join() === "rentals_ca,zumper" && round.byHand[0].portal === "kijiji");

// 5. Wiring.
const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok("save queues the update", /queueAdUpdates\(\{ supabase, org: orgAfterSave, propertyId: id, changed \}\)/.test(actions));
ok("only while the rental stays live", /priorStatus === "available" && effectiveStatus === "available" && orgAfterSave/.test(actions));
ok("takedown carries the mark", /notes: updateRepostNote\(/.test(actions));
ok("sweep in the 15-minute timer", (SWEEP_PATHS as readonly string[]).includes("/api/cron/ad-update-repost"));
const page = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
ok("saved notice shows the plan", /adUpdateNotice\(adUpdatePlanFromParam\(searchParams\.adupdate\)\)/.test(page));

console.log(`ad-edits-follow: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

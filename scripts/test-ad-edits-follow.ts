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
import { editableInPlace } from "../lib/ad-edits-follow";
import { builtInSwitchOn } from "../lib/platform-switches";
import { pagePostTextChanged } from "../lib/facebook-page-update";
import { isAdUpkeepTransport, workerJobEligible } from "../lib/distribution-worker";

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
// S764: Marketplace gets the helper's update button instead of the line.
const fbPlan = { repost: [], byHand: [{ portal: "facebook", url: null }, { portal: "kijiji", url: null }] };
ok("facebook left to the button", !/Facebook/.test(adUpdateNotice(fbPlan, ["facebook"]) ?? "") && /Kijiji still shows/.test(adUpdateNotice(fbPlan, ["facebook"]) ?? ""));
ok("facebook alone, button only", adUpdateNotice({ repost: [], byHand: [{ portal: "facebook", url: null }] }, ["facebook"]) === null);
ok("no dash, no mechanism", !/—|robot|worker/i.test(`${notice} ${updateTakedownAudit("zumper")} ${updateRepostAudit("zumper")}`));
const round = adUpdatePlanFromParam("rentals_ca,zumper,hand:kijiji");
ok("param round-trips", round.repost.join() === "rentals_ca,zumper" && round.byHand[0].portal === "kijiji");

// 5. Wiring.
const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok("save queues the update", /queueAdUpdates\(\{ supabase, org: orgForAds, propertyId: id, changed \}\)/.test(actions));
ok("only while the rental stays live", /priorStatus === "available" && effectiveStatus === "available"\) \{/.test(actions));
// The org is loaded for a plain edit too (orgAfterSave is only read on a status change; the first live proof found this).
ok("org read on a plain edit", /orgAfterSave \?\? \(await getCurrentOrg\(\)\)/.test(actions));
ok("takedown carries the mark", /notes: updateRepostNote\(/.test(actions));
ok("sweep in the 15-minute timer", (SWEEP_PATHS as readonly string[]).includes("/api/cron/ad-update-repost"));
const page = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
ok("saved notice shows the plan", /adUpdatePlanFromParam\(searchParams\.adupdate\)/.test(page) && /adUpdateNotice\(plan, showFbUpdate \? \["facebook"\] : \[\]\)/.test(page));
ok("saved notice offers the Marketplace update", /<MarketplaceUpdateButton kit=\{fbUpdateKit!\} editUrl=\{fbEditUrl!\} \/>/.test(page));

// S762: photos, the Facebook Page post and Kijiji in place.
{
  const plan2 = adUpdatePlan;
  const notice2 = adUpdateNotice;
  const fromParam = adUpdatePlanFromParam;
  const posts = [
    { id: "a", portal: "kijiji", status: "live", url: "https://www.kijiji.ca/v-x/1744721877" },
    { id: "b", portal: "zumper", status: "live", url: "https://www.zumper.com/x/listings/65724821" },
  ];
  const withEdit = plan2({ posts, aliveChannels: ["kijiji", "zumper"], postingAllowed: true, autopilot: true, editInPlace: ["kijiji"] });
  ok("Kijiji edited in place with the switch", JSON.stringify(withEdit.edit) === '["kijiji"]' && !withEdit.byHand.some((b) => b.portal === "kijiji"));
  ok("Zumper still re-posts", withEdit.repost.includes("zumper"));
  const noSwitch = plan2({ posts, aliveChannels: ["kijiji", "zumper"], postingAllowed: true, autopilot: true });
  ok("without the switch Kijiji stays by hand", noSwitch.byHand.some((b) => b.portal === "kijiji") && (noSwitch.edit ?? []).length === 0);
  const signedOut = plan2({ posts, aliveChannels: ["zumper"], postingAllowed: true, autopilot: true, editInPlace: ["kijiji"] });
  ok("signed out of Kijiji: by hand", signedOut.byHand.some((b) => b.portal === "kijiji"));
  ok("photos alone are not a Kijiji edit", !editableInPlace(["photos"]) && editableInPlace(["rent"]) && editableInPlace(["photos", "move-in date"]));
  ok("Page post text follows rent and description", pagePostTextChanged(["rent"]) && pagePostTextChanged(["description"]));
  ok("Page post text ignores photos and move-in", !pagePostTextChanged(["photos"]) && !pagePostTextChanged(["move-in date"]));
  const round = fromParam("page,zumper,edit:kijiji,hand:facebook");
  ok("param round trip", round.page === true && round.repost.join() === "zumper" && (round.edit ?? []).join() === "kijiji" && round.byHand[0].portal === "facebook");
  const n = notice2(round) ?? "";
  ok("notice names the Page, the edit and the re-post", n.includes("Facebook Page: we updated your post.") && n.includes("Kijiji: we are editing your ad. No new fee.") && n.includes("we are updating your ad"));
  ok("notice has no em dash", !/[—–]/.test(n));
  ok("edit is upkeep, not a post", isAdUpkeepTransport("edit") && isAdUpkeepTransport("takedown") && !isAdUpkeepTransport(null));
  ok("posting worker skips an edit item", !workerJobEligible({ mode: "concierge", transport: "edit", publishStatus: "queued", automationAuthorized: true, claimedBy: null } as Parameters<typeof workerJobEligible>[0]));
  const act = readFileSync("app/dashboard/properties/actions.ts", "utf8");
  ok("every photo change follows", (act.match(/await followPhotoChange\(supabase, propertyId\)/g) ?? []).length === 8);
  ok("a refresh on its way is not re-queued", act.includes("robotTakedownPending({ supabase, organizationId: org.id, propertyId })"));
  ok("Kijiji edits sit behind the staff switch", act.includes('orgHasSwitch(createAdminClient(), "kijiji_edits", org.id)'));
  ok("Page post edited on a text change", act.includes("pagePostTextChanged(changed)") && act.includes("updateFacebookPagePosts({"));
  const re = readFileSync("lib/robot-edit.ts", "utf8");
  ok("edit makes a run when the rental has none", re.includes('.from("distribution_runs")\n        .insert({ organization_id: args.organizationId, property_id: args.propertyId, status: "active" })'));
  ok("edit never takes over a row being worked on", re.includes('cur.transport !== EDIT_TRANSPORT && cur.publish_status !== "live"'));
  const sw = readFileSync("lib/platform-switches.ts", "utf8");
  // S764: Kijiji edits are on for every account now (proven twice on Agile); the
  // guard keeps the other two switches per account.
  ok("Kijiji edits on for every account", /kijiji_edits: \{[\s\S]{0,700}everyOrg: true/.test(sw) && builtInSwitchOn("kijiji_edits", "00000000-0000-0000-0000-000000000001"));
  ok("other switches stay per account", !builtInSwitchOn("shared_sms_number", "00000000-0000-0000-0000-000000000001") && !builtInSwitchOn("answers_own_enquiries", "00000000-0000-0000-0000-000000000001"));
  const mig = readFileSync("supabase/migrations/0274_signin_lost_text_and_kijiji_edit.sql", "utf8");
  ok("migration allows the edit transport", mig.includes("'takedown',\n      'edit'"));
}

console.log(`ad-edits-follow: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

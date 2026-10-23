// Run with: npx tsx scripts/test-posting-addon.ts
// S713 (Noam, 2026-10-13): the paid Posting add-on. CA$49 a month on top of
// Growth. Robot posting to Kijiji, Rentals.ca and Zumper needs it; the
// Marketplace kit and Facebook Page / Instagram stay in every plan.
import { readFileSync } from "node:fs";
import {
  POSTING_ADDON,
  POSTING_ADDON_HREF,
  POSTING_ADDON_NOTE,
  canUseRobotPosting,
  itemForPrice,
  planForPriceId,
  planPriceIdOfItems,
  postingAddonForSubscriptionEvent,
  postingAddonOffer,
  postingAddonPending,
  currentPlanTitle,
} from "../lib/billing";
import { isRobotPostedChannel } from "../lib/posting-lanes";
import { countWords, splitSentences } from "../lib/i18n/plain-words";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");

// --- 1. The gate helper ----------------------------------------------------
ok("growth + add-on = yes", canUseRobotPosting({ plan: "growth", posting_addon_active: true }));
ok("premium + add-on = yes", canUseRobotPosting({ plan: "premium", posting_addon_active: true }));
ok("managed + add-on = yes", canUseRobotPosting({ plan: "managed", posting_addon_active: true }));
ok("growth without add-on = no", !canUseRobotPosting({ plan: "growth", posting_addon_active: false }));
ok("growth, flag missing = no", !canUseRobotPosting({ plan: "growth" }));
ok("growth, flag null = no", !canUseRobotPosting({ plan: "growth", posting_addon_active: null }));
// S734: the add-on works on any plan, Free included (the webhook owns the flag).
for (const plan of ["free", "trial", "pilot", "core", "plus", null, undefined, "bogus"]) {
  ok(`${plan} + add-on flag = yes (S734, any plan)`, canUseRobotPosting({ plan, posting_addon_active: true }));
  ok(`${plan} without the flag = no`, !canUseRobotPosting({ plan, posting_addon_active: false }));
}
ok("null org = no", !canUseRobotPosting(null));

// --- 2. Config + copy --------------------------------------------------------
ok("add-on is CA$49", POSTING_ADDON.priceCents === 4900);
ok("price env name", POSTING_ADDON.priceEnv === "STRIPE_PRICE_POSTING_ADDON");
ok("note names the price in dollars", POSTING_ADDON_NOTE === "Part of the Posting add-on. $49 a month.");
ok("note links to billing", POSTING_ADDON_HREF.startsWith("/dashboard/billing"));
const copy = [POSTING_ADDON.blurb, ...POSTING_ADDON.features, POSTING_ADDON_NOTE];
for (const line of copy) {
  ok(`no em dash: ${line}`, !line.includes("—"));
  for (const sentence of splitSentences(line)) {
    ok(`<= 14 words: ${sentence}`, countWords(sentence) <= 14);
  }
}
ok("robot channels are the add-on's sites", ["kijiji", "rentals_ca", "zumper"].every(isRobotPostedChannel));
ok("Marketplace is not robot posted", !isRobotPostedChannel("facebook"));
ok("Facebook Page is not robot posted", !isRobotPostedChannel("facebook_feed"));
ok("Instagram is not robot posted", !isRobotPostedChannel("instagram"));

// --- 3. Webhook pure logic --------------------------------------------------
const ADDON = "price_addon";
const GROWTH = "price_growth";
const plans = { [GROWTH]: "growth" as const };
const addonItem = { id: "si_addon", price: { id: ADDON } };
const growthItem = { id: "si_growth", price: { id: GROWTH } };

ok("itemForPrice finds it", itemForPrice([growthItem, addonItem], ADDON)?.id === "si_addon");
ok("itemForPrice null price", itemForPrice([growthItem], null) === null);
ok("plan price with add-on first", planPriceIdOfItems([addonItem, growthItem], plans) === GROWTH);
ok("plan price with add-on second", planPriceIdOfItems([growthItem, addonItem], plans) === GROWTH);
ok("single item = items[0] as before", planPriceIdOfItems([growthItem], plans) === GROWTH);
ok("unknown single item = items[0] as before", planPriceIdOfItems([{ id: "x", price: { id: "p_x" } }], plans) === "p_x");
ok("no items = null", planPriceIdOfItems([], plans) === null);
ok("add-on is never a plan", planForPriceId(ADDON, plans) === null);

const ev = {
  addonPriceId: ADDON,
  items: [growthItem, addonItem],
  status: "active",
  statusApplies: true,
  ended: false,
  existingItemId: null as string | null,
};
const on = postingAddonForSubscriptionEvent(ev);
ok("active + add-on item -> on with item id", on?.active === true && on.itemId === "si_addon");
ok("trialing grants", postingAddonForSubscriptionEvent({ ...ev, status: "trialing" })?.active === true);
ok("past_due grants (grace)", postingAddonForSubscriptionEvent({ ...ev, status: "past_due" })?.active === true);
ok(
  "unpaid with a tracked item -> off",
  JSON.stringify(postingAddonForSubscriptionEvent({ ...ev, status: "unpaid", existingItemId: "si_addon" })) ===
    JSON.stringify({ active: false, itemId: null }),
);
ok(
  "incomplete first checkout, nothing tracked -> leave",
  postingAddonForSubscriptionEvent({ ...ev, status: "incomplete" }) === null,
);
ok(
  "item removed from a tracked sub -> off",
  postingAddonForSubscriptionEvent({ ...ev, items: [growthItem], existingItemId: "si_addon" })?.active === false,
);
ok(
  "GRANDFATHERED (flag on, no item) survives a plain Growth renewal",
  postingAddonForSubscriptionEvent({ ...ev, items: [growthItem], existingItemId: null }) === null,
);
ok(
  "grandfathered survives deletion too (plan gate covers it)",
  postingAddonForSubscriptionEvent({ ...ev, ended: true, existingItemId: null }) === null,
);
ok(
  "deleted sub with a tracked item -> off",
  postingAddonForSubscriptionEvent({ ...ev, ended: true, existingItemId: "si_addon" })?.active === false,
);
ok("stale event -> leave", postingAddonForSubscriptionEvent({ ...ev, statusApplies: false }) === null);
ok("price env unset -> leave", postingAddonForSubscriptionEvent({ ...ev, addonPriceId: null }) === null);

// --- 4. What the billing card offers ---------------------------------------
const offer = {
  priceConfigured: true,
  plan: "growth",
  addonActive: false,
  addonItemId: null as string | null,
  hasSubscription: true,
  subscriptionStatus: "active",
};
ok("growth, live sub -> add", postingAddonOffer(offer) === "add");
ok("free, no subscription -> add_free (S734)", postingAddonOffer({ ...offer, plan: "free", hasSubscription: false, subscriptionStatus: null }) === "add_free");
ok("free after a canceled sub -> add_free", postingAddonOffer({ ...offer, plan: "free", hasSubscription: true, subscriptionStatus: "canceled" }) === "add_free");
ok("canceled growth -> needs_growth", postingAddonOffer({ ...offer, subscriptionStatus: "canceled" }) === "needs_growth");
ok("no price -> unavailable (no buy button)", postingAddonOffer({ ...offer, priceConfigured: false }) === "unavailable");
ok("bought -> on_bought", postingAddonOffer({ ...offer, addonActive: true, addonItemId: "si_1" }) === "on_bought");
ok("grandfathered -> on_included", postingAddonOffer({ ...offer, addonActive: true }) === "on_included");
ok(
  "grandfathered shows on even with no price set",
  postingAddonOffer({ ...offer, addonActive: true, priceConfigured: false }) === "on_included",
);

// --- 5. Migration ----------------------------------------------------------
const mig = read("supabase/migrations/0244_posting_addon.sql");
ok("adds posting_addon_active not null default false", /posting_addon_active boolean not null default false/.test(mig));
ok("adds posting_addon_subscription_item_id text null", /posting_addon_subscription_item_id text null/.test(mig));
ok("grandfathers Agile by name", /set posting_addon_active = true\s+where name = 'Agile Real Estate Group'/.test(mig));
ok("does not hardcode Agile's id", !mig.includes("921f7c08"));
ok("owner cannot self-grant (guard trigger)", mig.includes("before update on public.organizations") && mig.includes("current_user in ('authenticated', 'anon')"));
ok("worker claim RPC checks the add-on", /p_channel in \('kijiji', 'rentals_ca', 'zumper'\)[\s\S]{0,80}org_can_use_robot_posting/.test(mig));
ok("SQL twin needs a paid plan", mig.includes("o.plan in ('growth', 'premium', 'managed') and o.posting_addon_active"));
ok("claim RPC keeps the 0243 spend limits", mig.includes("spend_period_cap") && mig.includes("distribution_period_spend_cents"));
ok("claim RPC grant kept", /grant execute on function public\.claim_approved_distribution_run_item_for_worker/.test(mig));

// --- 6. Wiring: every gate site --------------------------------------------
const access = read("lib/robot-posting-access.ts");
ok("access helper runs canUseRobotPosting", access.includes("canUseRobotPosting(row)"));
ok("access helper fails closed", access.includes("return CLOSED"));

const actions = read("app/dashboard/properties/actions.ts");
const sitePost = actions.slice(actions.indexOf("export async function startSitePost"), actions.indexOf("export async function cancelDistributionRun"));
ok("startSitePost gates robot sites", sitePost.includes("isRobotPostedChannel(channel)") && sitePost.includes("readRobotPostingAccess") && sitePost.includes("run=postingaddon"));
const concierge = actions.slice(actions.indexOf("export async function requestConciergePublish"));
ok("requestConciergePublish gates on the RUN's org", concierge.includes("readRobotPostingAccess(supabase, runOrgId)") && concierge.includes("run=postingaddon"));

const dist = read("app/dashboard/properties/distribution-actions.ts");
const approve = dist.slice(dist.indexOf("export async function authorizeAutopilotSubmit"), dist.indexOf("export async function setRelistRadarStandingAutoRefresh"));
ok("owner approve gates robot sites", approve.includes("isRobotPostedChannel(pendingItem.channel)") && approve.includes("readRobotPostingAccess"));
ok("owner approve gate runs before the approval write", approve.indexOf("readRobotPostingAccess") < approve.indexOf("operator_submit_approved_at: now"));
ok("owner approve gate runs before waking the robot", approve.indexOf("readRobotPostingAccess") < approve.indexOf("triggerPostNow()"));

const desk = read("app/dashboard/admin/concierge-actions.ts");
const deskApprove = desk.slice(desk.indexOf("export async function approveConciergeSubmit"));
ok("desk approve gates robot sites", deskApprove.includes("isRobotPostedChannel") && deskApprove.includes("readRobotPostingAccess(admin"));
ok("desk approve gate before the approval write", deskApprove.indexOf("readRobotPostingAccess") < deskApprove.indexOf("operator_submit_approved_at: now"));
ok("desk shows the add-on error", read("app/dashboard/admin/concierge/page.tsx").includes('err === "posting_addon"'));

const worker = read("app/api/cron/distribution-worker/route.ts");
ok("worker cron skips robot jobs without the add-on", worker.includes("isRobotPostedChannel(c.channel)") && worker.includes("readRobotPostingAccess(admin, c.organization_id)"));
ok("worker cron gate before the claim", worker.indexOf("readRobotPostingAccess(admin, c.organization_id)") < worker.indexOf("concierge_claimed_by: WORKER_CLAIM_ID"));

const fresh = read("app/api/cron/distribution-freshness/route.ts");
ok("relist refresh skips orgs without the add-on", fresh.includes('reason: "posting_addon_required"'));

const signinActions = read("app/dashboard/site-signin/[channel]/actions.ts");
ok("sign-in start gated", signinActions.includes("readRobotPostingAccess") && signinActions.indexOf("readRobotPostingAccess") < signinActions.indexOf("triggerSigninWindow(created.id"));
const signinPage = read("app/dashboard/site-signin/[channel]/page.tsx");
ok("sign-in page shows the note, not the form", signinPage.includes("access.allowed &&") && signinPage.includes("POSTING_ADDON_NOTE"));

const pe = read("app/dashboard/properties/[id]/publish-everywhere.tsx");
ok("site rows get the add-on lock", pe.includes("const locked = (row: ResolvedRow) => !robotPostingAllowed && isRobotPostedChannel(row.key);") && pe.includes("addonLocked={locked(row)}"));
// S734c: the one-line rows render inside ForYouHandoff with the same lock.
ok("other rows get the add-on lock", pe.includes("addonLocked={locked(r)}"));
// S734: one Posting offer card under the list, no note per locked row.
ok("locked rows share one Posting offer card", pe.includes("<PostingOfferCard />") && !pe.includes("<PostingAddonNote"));
ok("UI defaults closed", pe.includes("robotPostingAllowed = false"));
ok("Marketplace kit row is never locked", !isRobotPostedChannel("facebook") && pe.includes("<MarketplaceRow"));
const page = read("app/dashboard/properties/[id]/page.tsx");
ok("property page passes the real gate", page.includes("robotPostingAllowed={robotPostingAccess.allowed}"));
ok("property page explains run=postingaddon", page.includes('searchParams.run === "postingaddon"'));

const vm = read("app/dashboard/link-portals/view-model.ts");
ok("link-portals tile: add-on button instead of sign-in button", vm.includes("if (needsAddon) {") && vm.includes("isRobotPostedChannel(row.channel)"));
const en = JSON.parse(read("messages/en.json"));
const fr = JSON.parse(read("messages/fr.json"));
ok("en addon copy", en.stage1.addon.note === POSTING_ADDON_NOTE && !!en.stage1.addon.link);
ok("fr addon copy", !!fr.stage1.addon.note && !!fr.stage1.addon.link);

// --- 7. Stripe + billing page ----------------------------------------------
const webhook = read("app/api/stripe/webhook/route.ts");
ok("webhook mirrors the add-on", webhook.includes("postingAddonForSubscriptionEvent({"));
ok("webhook picks the plan item, not items[0]", webhook.includes("planPriceIdOfItems(") && !webhook.includes("sub.items?.data?.[0]?.price?.id"));
ok("webhook clears the add-on on deletion", /ended: true, statusApplies: true/.test(webhook));
const stripeLib = read("lib/stripe.ts");
ok("price env documented", stripeLib.includes("STRIPE_PRICE_POSTING_ADDON"));
const priceMapBody = stripeLib.slice(
  stripeLib.indexOf("export function priceMap"),
  stripeLib.indexOf("export function isBillingConfigured"),
);
ok("add-on kept out of the plan price map", priceMapBody.length > 0 && !priceMapBody.includes("POSTING_ADDON"));

const billingActions = read("app/dashboard/billing/actions.ts");
ok("add uses subscriptionItems.create with proration", billingActions.includes("subscriptionItems.create(") && billingActions.includes('proration_behavior: "create_prorations"'));
ok("remove deletes the subscription item", billingActions.includes("subscriptionItems.del("));
ok("checkout can carry Growth + Posting", billingActions.includes('formData.get("with_posting")') && billingActions.includes("lineItems.push({ price: addonPriceId"));
ok("add does not grant the flag itself (webhook does)", !/posting_addon_active:\s*true/.test(billingActions));
ok("both add/remove are owner-only", (billingActions.match(/requireCapability\("manage_billing"/g) ?? []).length >= 6);
const billingPage = read("app/dashboard/billing/page.tsx");
ok("billing page renders the card", billingPage.includes('id="posting-addon"') && billingPage.includes("postingAddonOffer({"));
ok("no buy button when price unset (admin-only note)", billingPage.includes('addonOffer === "unavailable"') && billingPage.includes("viewerIsAdmin ?"));

// --- 8. Homepage -------------------------------------------------------------
const home = read("app/page.tsx");
ok("homepage names the add-on under Growth", home.includes('addon: "Add Posting for CA$49 a month. See below."')); // S722b: the add-on has its own card
// S720: the homepage says Kijiji charges its own fee, as Billing does.
ok("homepage says Kijiji charges its own fee", home.includes("Kijiji charges its own fee for each ad."));
ok("homepage renders the add-on line", home.includes("{p.addon}"));

// S714: no second buy button while a purchase is still landing.
ok("pending: just added, flag not flipped yet", postingAddonPending("add", { addon: "added" }) === "switching_on");
ok("pending: Growth+Posting checkout back, plan not flipped yet", postingAddonPending("needs_growth", { checkout: "success" }) === "switching_on");
ok("pending: just removed, still on", postingAddonPending("on_bought", { addon: "removed" }) === "switching_off");
ok("not pending once the add lands", postingAddonPending("on_bought", { addon: "added" }) === null);
ok("not pending once the removal lands", postingAddonPending("add", { addon: "removed" }) === null);
ok("not pending with no URL signal", postingAddonPending("add", {}) === null);
ok("a cancelled checkout is not pending", postingAddonPending("needs_growth", { checkout: "cancel" }) === null);
ok("pending: Posting-only checkout back on Free (S734)", postingAddonPending("add_free", { checkout: "posting" }) === "switching_on");
{
  const page = read("app/dashboard/billing/page.tsx");
  ok("billing page checks pending before any buy button", page.indexOf("addonPending ?") > 0 && page.indexOf("addonPending ?") < page.indexOf("Add Posting for"));
}

// S714b: the add-on shows in the Current plan card.
ok("bought add-on is named with the plan", currentPlanTitle("Growth", "on_bought") === "Growth + Posting");
ok("grandfathered add-on reads included", currentPlanTitle("Growth", "on_included") === "Growth + Posting (included)");
ok("no add-on, plan only", currentPlanTitle("Growth", "add") === "Growth" && currentPlanTitle("Free", "needs_growth") === "Free");
ok("billing page uses the title helper", read("app/dashboard/billing/page.tsx").includes("currentPlanTitle(view.planLabel, addonOffer)"));

console.log(`\nposting-addon: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

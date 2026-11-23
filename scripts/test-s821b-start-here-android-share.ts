// S821b: a short "Start here" path on Getting started, and Android "Share to
// Vacantless" (no Shortcut, no key).
// Run: npx tsx scripts/test-s821b-start-here-android-share.ts
import { readFileSync } from "node:fs";
import { computeOnboardingState } from "../lib/onboarding-wizard";
import { ANDROID_SHARE_NOTE, ANDROID_SHARE_STEPS, SHARE_DONE_LABEL, SHARE_COPIED_LINE, INSTALL_BUTTON_LABEL, INSTALLED_LINE, installState, SHARE_TARGET_FIELD, SHARE_TARGET_PATH, escapeHtml, renderSharePage, shareSaved } from "../lib/share-target";
import { PHONE_REPLY_NOTE_MARKS } from "../lib/reply-kit-server";
import { sendResultLine } from "../lib/send-shortcut";
import manifest from "../app/manifest";
import { buildSitesSetup } from "../lib/sites-setup";
import { TRANSLATE_HINT_EMAIL, TRANSLATE_LANGUAGE_NAMES } from "../lib/translate-hint";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`, extra ?? "");
  }
}
const read = (p: string) => readFileSync(p, "utf8");

// --- Start here ---------------------------------------------------------------
const full = {
  hasProperty: false,
  hasLiveListing: false,
  hasTenancy: false,
  wizardEnabled: true,
  railStepDoneAt: null,
  dismissedAt: null,
  hasViewingTimes: false,
  hasConnectedSite: false,
  hasLead: false,
  hasPhoneReplies: false,
};
const fresh = computeOnboardingState(full);
const startKeys = fresh.steps.filter((s) => s.group === "start").map((s) => s.key).join(",");
const laterKeys = fresh.steps.filter((s) => s.group === "later").map((s) => s.key).join(",");
ok("a new landlord starts with four steps", startKeys === "property,viewing_times,connect_sites,get_online", startKeys);
ok("the rest wait under Later", laterKeys === "see_it_work,phone_replies,tenancy,rent_rail", laterKeys);
ok("the count is 0 of 4", fresh.startDoneCount === 0 && fresh.startTotalCount === 4 && !fresh.startComplete);
ok("every start step comes before every later step", fresh.steps.findIndex((s) => s.group === "later") === 4);
ok("the next step is always a start step until the ad is up", fresh.nextIncompleteStep?.group === "start");
const withEmails = computeOnboardingState({ ...full, hasRenterEmails: false });
ok("accounts that post to Kijiji keep renter emails in the start path", withEmails.steps.find((s) => s.key === "renter_emails")?.group === "start" && withEmails.startTotalCount === 5);
const live = computeOnboardingState({ ...full, hasProperty: true, hasViewingTimes: true, hasConnectedSite: true, hasLiveListing: true });
ok("an ad up finishes the start path", live.startComplete && live.startDoneCount === 4 && live.nextIncompleteStep?.group === "later");
ok("the checklist is not complete yet", !live.isComplete && live.shouldShowCard);
const connect = fresh.steps.find((s) => s.key === "connect_sites")!;
ok("connect step says one site is enough", connect.description.startsWith("One site is enough to start."));
const phone = fresh.steps.find((s) => s.key === "phone_replies")!;
// S824d: one QR scan sets up either phone.
ok("phone step names Android", /iPhone or Android/.test(phone.description) && /Show a code for my phone/.test(phone.description) && !/Marketplace/.test(phone.description));

const gs = read("app/dashboard/(wizard)/getting-started/page.tsx");
ok("page has Do these first and Later", gs.includes("Do these first") && gs.includes("Later, when you are ready"));
ok("Later is closed until the start path is done", gs.includes("open={!starting || Boolean(searchParams?.wizard)}"));
ok("the helper line shows only when the plan has a seat", gs.includes("canInviteHelper && starting") && gs.includes("teammateLimit(org.plan) > 0") && gs.includes("/dashboard/settings?tab=team"));
const card = read("app/dashboard/getting-started-card.tsx");
ok("Today card counts the short path first", card.includes("to get your first ad up") && card.includes("state.startDoneCount"));

// --- Android share ------------------------------------------------------------
const m = manifest() as unknown as { share_target?: { action: string; method: string; enctype: string; params: { files: { name: string; accept: string[] }[] } } };
ok("manifest has a share target at the route", m.share_target?.action === SHARE_TARGET_PATH && m.share_target?.method === "POST" && m.share_target?.enctype === "multipart/form-data");
ok("the file field is the one the route reads", m.share_target?.params.files[0]?.name === SHARE_TARGET_FIELD && m.share_target.params.files[0].accept.includes("image/png"));
ok("the share target is inside the app's scope", SHARE_TARGET_PATH.startsWith("/dashboard/"));
const route = read("app/dashboard/replies/shared/route.ts");
ok("the route uses the sign-in, not a key", route.includes("supabase.auth.getUser()") && !route.includes("checkSendKey") && !route.includes("readSendKey"));
ok("the route checks the role", route.includes('roleCan(role, "manage_leads")'));
ok("signed out goes to log in with a note", route.includes("share%3Dsignin") && read("app/dashboard/replies/page.tsx").includes('searchParams?.share === "signin"'));
ok("the route saves the same way as the iPhone Shortcut", route.includes("saveRenterFromShortcut(") && route.includes("via: ANDROID_SHARE_NOTE"));
ok("a route file exports only handlers and config", !/export const (?!dynamic|maxDuration)/.test(route));
ok("an Android share counts for the phone step", PHONE_REPLY_NOTE_MARKS.some((mark) => ANDROID_SHARE_NOTE.includes(mark)));
ok("the iPhone note is unchanged by default", read("lib/send-shortcut-server.ts").includes('opts.via ?? "Sent from the iPhone share menu (chat screenshot)."'));
ok("three short Android steps, no key", ANDROID_SHARE_STEPS.length === 3 && ANDROID_SHARE_STEPS.every((s) => !/key/i.test(s)));
ok("Quick replies shows the Android steps", read("app/dashboard/replies/send-shortcut-card.tsx").includes("ANDROID_SHARE_STEPS.map"));

ok("saved and already-there count as saved", shareSaved(sendResultLine({ outcome: "saved", name: "Maya", rental: "1 Main St" })) && shareSaved(sendResultLine({ outcome: "exists", name: "Maya" })));
ok("a miss does not", !shareSaved(sendResultLine({ outcome: "no_renter" })) && !shareSaved(sendResultLine({ outcome: "unreadable" })) && !shareSaved(sendResultLine({ outcome: "not_available", rental: "1 Main St" })));
ok("escapeHtml", escapeHtml(`<b a="1">&'`) === "&lt;b a=&quot;1&quot;&gt;&amp;&#39;");
const html = renderSharePage({ line: "Saved <Maya> in Renters.", reply: "Hi Maya,\n</pre><script>x</script>", link: "/dashboard/leads/abc", ok: true });
ok("the page escapes the renter's words", html.includes("Saved &lt;Maya&gt; in Renters.") && !html.includes("<script>x</script>") && html.includes("&lt;/pre&gt;"));
ok("the page has Copy reply and the renter link", html.includes('id="copy"') && html.includes('href="/dashboard/leads/abc"') && html.includes("<h1>Saved</h1>"));
const miss = renderSharePage({ line: "We could not read that picture.", reply: null, link: null, ok: false });
// S833f: a miss now has the Done button's script, but still no reply box or copy handler.
ok("a miss has no reply box and no copy script", miss.includes("<h1>Not saved</h1>") && !miss.includes('id="copy"') && !miss.includes('getElementById("copy")'));
// S833b: one-tap install button on Android.
ok("installed app says installed", installState({ android: true, standalone: true, promptReady: true }) === "installed");
ok("Chrome offers install: button shows", installState({ android: true, standalone: false, promptReady: true }) === "ready");
ok("Android, no offer: nothing shows", installState({ android: true, standalone: false, promptReady: false }) === "none");
ok("iPhone home-screen app is never told it is in the Share menu", installState({ android: false, standalone: true, promptReady: false }) === "none");
{
  const btn = read("components/install-app-button.tsx");
  ok("button waits for beforeinstallprompt", btn.includes("beforeinstallprompt") && btn.includes("preventDefault()") && btn.includes(".prompt()"));
  ok("Quick replies shows the install button under the Android steps", /ANDROID_SHARE_STEPS\.map[\s\S]*<InstallAppButton \/>/.test(read("app/dashboard/replies/send-shortcut-card.tsx")));
  ok("step 2 names the button", ANDROID_SHARE_STEPS[1].includes(INSTALL_BUTTON_LABEL));
  ok("install copy has no em dash", ![INSTALL_BUTTON_LABEL, INSTALLED_LINE].some((t) => t.includes("\u2014")));
}
// S833d: a big shared picture is shrunk on the phone (Vercel 413 at ~4.5 MB).
{
  const sw = read("public/share-sw.js");
  ok("worker catches only the share POST", sw.includes('const SHARE_PATH = "/dashboard/replies/shared"') && sw.includes('req.method !== "POST"') && sw.includes("url.pathname !== SHARE_PATH"));
  ok("worker keeps the field name", sw.includes(`const FIELD = "${SHARE_TARGET_FIELD}"`));
  ok("worker shrinks to well under the limit", /MAX_SIDE = 2000/.test(sw) && sw.includes("convertToBlob"));
  ok("worker falls back to the original on any error", sw.includes("return file;") && sw.includes("return fetch(req);"));
  ok("worker passes the sign-in redirect through", sw.includes('redirect: "manual"'));
  const reg = read("components/share-sw-register.tsx");
  ok("worker registered on Android only", reg.includes("/Android/i.test") && reg.includes('register("/share-sw.js")'));
  ok("root layout registers it", read("app/layout.tsx").includes("<ShareSwRegister />"));
}
// S833e: Android builds the reply in the renter's own account, like the iPhone path.
{
  const route = read("app/dashboard/replies/shared/route.ts");
  ok("reply cards come from the renter's account", route.includes("const replyOrgId = r.orgId ?? org.id;") && route.includes("loadReplyKitCards(admin, admin, replyOrgId,"));
  ok("phone comes from the renter's account", route.includes('.select("public_contact_phone").eq("id", replyOrgId)'));
  ok("reply uses the topic", route.includes("topic: r.topic ?? null"));
}
// S833f: a Done button closes the share screen (Noam: "Done" should reset it).
{
  const withReply = renderSharePage({ line: "Saved Kym in Renters.", reply: "Hi Kym", link: "/dashboard/leads/x", ok: true });
  const noReply = renderSharePage({ line: "Saved Kym in Renters.", reply: null, link: null, ok: true });
  ok("heading says Saved, not Done", withReply.includes("<h1>Saved</h1>") && !withReply.includes("<h1>Done</h1>"));
  ok("Done button on every share screen", [withReply, noReply].every((h) => h.includes(`id="done"`) && h.includes(`>${SHARE_DONE_LABEL}</button>`)));
  ok("Done closes, then falls back to the app home", withReply.includes("window.close()") && withReply.includes('location.replace("/dashboard")'));
  ok("copied line says to tap Done", withReply.includes(SHARE_COPIED_LINE) && SHARE_COPIED_LINE.includes("Done"));
  ok("copy still works with Done added", withReply.includes('getElementById("copy")'));
}
ok("no em dash in the new copy", ![html, miss, ...ANDROID_SHARE_STEPS, connect.description, phone.description].some((t) => t.includes("—")));

// --- S821d: first visits are one question -------------------------------------
{
  const base = { tileStateByChannel: {}, postingAllowed: true, helperInstalled: false, postingHref: "/dashboard/billing#posting" };
  const first = buildSitesSetup({ ...base, firstTime: true });
  const kijiji = first.rows.find((r) => r.key === "kijiji");
  ok("first time: a site row opens its own page", kijiji?.action?.href === "/dashboard/site-signin/kijiji" && kijiji.action.label === "Sign in or make my account", kijiji?.action);
  const later = buildSitesSetup(base);
  ok("later: the row keeps the walk through all three", later.rows.find((r) => r.key === "kijiji")?.action?.href === "/dashboard/site-signin");
  const ended = buildSitesSetup({ ...base, firstTime: true, tileStateByChannel: { kijiji: "dead_session" } });
  ok("an ended sign-in still says Sign in again", ended.rows.find((r) => r.key === "kijiji")?.action?.label === "Sign in again");
  const sites = read("app/dashboard/sites/page.tsx");
  ok("sites page leads with one choice when nothing is connected", sites.includes("Pick one site to begin.") && sites.includes("const firstTime = !orgHasConnectedSite(tileStateByChannel)"));
  ok("the price line comes after the rows on a first visit", sites.indexOf("Pick one site to begin.") < sites.indexOf("<SitesRows") && sites.lastIndexOf("See Posting") > sites.lastIndexOf("<SitesRows"));
  ok("the all-three button waits", read("app/dashboard/sites/sites-rows.tsx").includes("setup.nextSignin && !input.firstTime"));
  const av = read("app/dashboard/availability/page.tsx");
  ok("viewing times: a first visit shows one-tap choices", av.includes("When can you show the rental?") && av.includes("VIEWING_PRESETS.map") && av.includes('name="from" value="availability"'));
  ok("viewing times: the rest waits under More settings", av.includes('<details id="more-settings"') && av.includes("open={!firstVisit}") && av.includes("</details>"));
  ok("viewing times: first visit means never set, past dates count (S821f)", av.includes("const firstVisit = rules.length === 0 && (overridesData ?? []).length === 0;") && !av.includes("const firstVisit = rules.length === 0 && overrides.length === 0;"));
  ok("the preset stays on the page when started there", read("app/dashboard/availability/actions.ts").includes('redirect("/dashboard/availability?saved=preset")'));
}

// S821d: the Punjabi walk. Chrome's translator renamed the brand and the account.
{
  const layout = read("app/dashboard/layout.tsx");
  ok("the brand is not translated", layout.includes('<span translate="no" className="notranslate">Vacantless</span>'));
  ok("the account name is not translated", layout.includes('<h1 translate="no" className="notranslate text-lg font-bold">{org.name}</h1>'));
}

// S821e: four translated walks (Punjabi, Hindi, Arabic, Chinese).
{
  const av = read("app/dashboard/availability/page.tsx");
  const shown = av.split("\n").filter((l) => !/^\s*(\/\/|\{\/\*|\*)/.test(l) && !/[wW]indow(_invalid|:)|AvailabilityWindow/.test(l)).join("\n");
  ok("viewing times page says times, never windows", !/[wW]indows?\b/.test(shown), shown.match(/.*[wW]indows?\b.*/)?.[0]);
  ok("names and addresses are not translated", read("components/ui.tsx").includes("titleNoTranslate") && read("app/dashboard/properties/[id]/page.tsx").includes("titleNoTranslate") && read("app/dashboard/leads/[id]/page.tsx").includes("titleNoTranslate={Boolean(l.name || l.email)}") && read("app/dashboard/properties/page.tsx").includes('translate="no"'));
  ok("language names are in their own script", TRANSLATE_LANGUAGE_NAMES.length === 5 && TRANSLATE_HINT_EMAIL.includes("Always translate"));
  ok("Getting started shows the language line", read("app/dashboard/(wizard)/getting-started/page.tsx").includes('id="translate-hint"'));
  ok("the welcome email carries it", read("lib/onboarding-emails.ts").includes("TRANSLATE_HINT_EMAIL,"));
}

// S821g: found on the fresh S821 sign-up.
{
  const gs2 = read("app/dashboard/(wizard)/getting-started/page.tsx");
  const first = gs2.indexOf(">Do these first</h2>");
  ok("the steps come before the language, video and helper boxes", first > 0 && first < gs2.indexOf('id="translate-hint"') && first < gs2.indexOf("Prefer to watch?") && first < gs2.indexOf("canInviteHelper && starting"));
  ok("progress stays above the steps", gs2.indexOf("wizard-progress-title") < first);
  ok("welcome email says one site is enough", read("lib/onboarding-emails.ts").includes("One site is enough to begin"));
}

// S822: names and addresses stay out of Chrome's translator on the remaining screens.
{
  const showings = read("app/dashboard/showings/page.tsx");
  ok("viewings: renter name not translated", showings.includes('<span translate="no" className="notranslate">{s.lead.name || s.lead.email || "Renter"}</span>'));
  ok("viewings: address not translated", showings.includes('<span translate="no" className="notranslate">{s.property.address}</span>'));
  const tenancies = read("app/dashboard/tenancies/page.tsx");
  ok("tenancies: names and address not translated", tenancies.includes('translate="no" className="notranslate block truncate') && tenancies.includes('{t.property?.address ?? "Unit removed"}</span>'));
  ok("tenancy page: name not translated", read("app/dashboard/tenancies/[id]/page.tsx").includes("titleNoTranslate={Boolean(primary?.name || primary?.email)}"));
  ok("quick replies: rental not translated", read("app/dashboard/replies/reply-kit.tsx").includes('<div translate="no" className="notranslate text-sm font-medium text-gray-800">{card.rental}</div>'));
}

console.log(`\ns821b: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

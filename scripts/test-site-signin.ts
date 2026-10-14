// S705: "Sign in once" helpers and the GitHub dispatch shape.
// Run: npx tsx scripts/test-site-signin.ts
import {
  SITE_SIGNIN_ACCOUNT_FIRST,
  isSiteSigninChannel,
  settingsAccountStatusToSave,
  siteSigninEnabled,
  siteSigninHref,
  siteSigninIsOpen,
  siteSigninLinksOn,
  siteSigninPassword,
  siteSigninSafeViewUrl,
  siteSigninView,
} from "../lib/site-signin";
import { sessionCheckRequest, signinWindowEvent, signinWindowRequest, triggerSessionCheck, triggerSigninWindow } from "../lib/site-signin-dispatch";
import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
    if (extra !== undefined) console.error("    ->", JSON.stringify(extra));
  }
}

async function main() {
  // S717: Rentals.ca signs in too, on the home runner.
  ok("kijiji, zumper and rentals.ca", isSiteSigninChannel("kijiji") && isSiteSigninChannel("zumper") && isSiteSigninChannel("rentals_ca") && !isSiteSigninChannel("facebook"));
  ok("rentals.ca window opens at home", signinWindowEvent("rentals_ca") === "signin-window-home");
  ok("kijiji and zumper windows open on GitHub", signinWindowEvent("kijiji") === "signin-window" && signinWindowEvent("zumper") === "signin-window");
  ok(
    "rentals.ca dispatch names the home event",
    JSON.parse(String(signinWindowRequest("t", "w", "vacantless/vacantless-worker", "rentals_ca").init.body)).event_type === "signin-window-home",
  );
  ok("dark by default", !siteSigninEnabled({}, {}) && !siteSigninLinksOn({}));
  ok("our team can always open it", siteSigninEnabled({ isPlatformAdmin: true }, {}));
  ok("flag opens it for everyone", siteSigninEnabled({}, { SITE_SIGNIN_ENABLED: "true" }) && siteSigninLinksOn({ SITE_SIGNIN_ENABLED: "true" }));
  ok("links stay off for a platform admin while dark", !siteSigninLinksOn({}));
  ok("href", siteSigninHref("zumper") === "/dashboard/site-signin/zumper");
  ok("open statuses", siteSigninIsOpen("starting") && siteSigninIsOpen("ready") && siteSigninIsOpen("saving") && !siteSigninIsOpen("done") && !siteSigninIsOpen(null));

  const good = "https://quiet-river.trycloudflare.com/vnc.html#autoconnect=1&resize=scale&password=Ab3dEf9h";
  ok("password read from the fragment", siteSigninPassword(good) === "Ab3dEf9h");
  ok("no fragment, no password", siteSigninPassword("https://x.trycloudflare.com/vnc.html") === null);
  ok("odd password refused", siteSigninPassword("https://x.trycloudflare.com/vnc.html#password=<script>") === null);
  ok("our link is shown", siteSigninSafeViewUrl(good) === good);
  ok("another host is never shown", siteSigninSafeViewUrl("https://evil.example.com/vnc.html#password=x") === null);
  ok("http is never shown", siteSigninSafeViewUrl("http://a.trycloudflare.com/vnc.html") === null);
  ok("another path is never shown", siteSigninSafeViewUrl("https://a.trycloudflare.com/login") === null);

  for (const s of [null, "starting", "ready", "saving", "done", "expired", "cancelled", "failed"]) {
    const v = siteSigninView("zumper", s);
    ok(`copy for ${s} has no em dash`, !/—/.test(v.title + v.body), v);
  }
  ok("ready says the password stays with them", /stays with you/.test(siteSigninView("kijiji", "ready").body));
  ok("a failed check says so", /not show you as signed in yet/.test(siteSigninView("kijiji", "ready", "not_signed_in_yet").body));
  ok("done says each post is still approved", /approve each post/.test(siteSigninView("zumper", "done").body));

  const req = signinWindowRequest("t0k", "win-1", "vacantless/vacantless-worker");
  ok("dispatch url", req.url === "https://api.github.com/repos/vacantless/vacantless-worker/dispatches");
  const body = JSON.parse(String(req.init.body));
  ok("dispatch event and payload", body.event_type === "signin-window" && body.client_payload.window_id === "win-1", body);
  ok("no token, no dispatch", (await triggerSigninWindow("w", "kijiji", (async () => new Response(null, { status: 204 })) as typeof fetch, undefined)) === false);
  ok("204 = dispatched", (await triggerSigninWindow("w", "kijiji", (async () => new Response(null, { status: 204 })) as typeof fetch, "t")) === true);
  ok("refusal = false", (await triggerSigninWindow("w", "kijiji", (async () => new Response(null, { status: 404 })) as typeof fetch, "t")) === false);
  ok("a throw = false", (await triggerSigninWindow("w", "kijiji", (async () => { throw new Error("x"); }) as typeof fetch, "t")) === false);

  const sc = sessionCheckRequest("t0k", "org-1", ["zumper"], "vacantless/vacantless-worker");
  const scBody = JSON.parse(String(sc.init.body));
  ok("session check dispatch event", sc.url.endsWith("/vacantless/vacantless-worker/dispatches") && scBody.event_type === "session-check" && scBody.client_payload.org_id === "org-1" && scBody.client_payload.channels[0] === "zumper", scBody);
  ok("session check: nothing requested, no dispatch", (await triggerSessionCheck("o", [], (async () => new Response(null, { status: 204 })) as typeof fetch, "t")) === false);
  ok("session check: no token, no dispatch", (await triggerSessionCheck("o", ["zumper"], (async () => new Response(null, { status: 204 })) as typeof fetch, undefined)) === false);
  ok("session check: 204 = dispatched", (await triggerSessionCheck("o", ["zumper"], (async () => new Response(null, { status: 204 })) as typeof fetch, "t")) === true);
  ok("tile copy no longer promises under a minute", !/under a minute/.test(readFileSync("messages/en.json", "utf8")));

  // The page and actions keep their guards.
  const actions = readFileSync("app/dashboard/site-signin/[channel]/actions.ts", "utf8");
  ok("actions require manage_properties", actions.includes('requireCapability("manage_properties"'));
  ok("actions check the flag", actions.includes("siteSigninEnabled("));
  ok("updates are scoped to the org", actions.includes('.eq("organization_id", who.orgId)'));
  const page = readFileSync("app/dashboard/site-signin/[channel]/page.tsx", "utf8");
  ok("page 404s when dark for this user", page.includes("notFound()") && page.includes("siteSigninEnabled("));
  ok("page states the consent before starting", page.includes("you let us post the ads you approve"));
  const vm = readFileSync("app/dashboard/link-portals/view-model.ts", "utf8");
  ok("site tiles point at the window when on", vm.includes("siteSigninLinksOn() && isSiteSigninChannel(row.channel)"));
  // S711: with sign-in once on, Settings keeps only the paid-ad limits and
  // never blanks a saved account name.
  const settings = readFileSync("app/dashboard/settings/page.tsx", "utf8");
  ok("settings drops free sites when sign-in once is on", settings.includes("if (siteSigninLinksOn() && !cap.requiresPayment) return false;"));
  ok("settings keeps the saved account name as a hidden field", settings.includes('name="external_account_label"\n                        value={account?.external_account_label ?? ""}'));

  // S712 (Codex review): a Save of the paid-ad limits never flips the status
  // when sign-in once is on.
  ok("sign-in once on keeps not_started", settingsAccountStatusToSave("not_started", true) === "not_started");
  ok("sign-in once on keeps connected", settingsAccountStatusToSave("connected", true) === "connected");
  ok("flag off: first naming waits on a sign-in", settingsAccountStatusToSave("not_started", false) === "needs_login");
  ok("flag off keeps other statuses", settingsAccountStatusToSave("connected", false) === "connected");
  ok("settings uses the helper", settings.includes("settingsAccountStatusToSave("));

  // S714: tell the landlord to make the site account first (Zumper checks ID).
  ok("zumper hint names the landlord account and the ID check", /landlord account/.test(SITE_SIGNIN_ACCOUNT_FIRST.zumper.text) && /ID/.test(SITE_SIGNIN_ACCOUNT_FIRST.zumper.text));
  ok("hint links go to the real sites", SITE_SIGNIN_ACCOUNT_FIRST.zumper.href.startsWith("https://www.zumper.com/") && SITE_SIGNIN_ACCOUNT_FIRST.kijiji.href.startsWith("https://www.kijiji.ca/"));
  {
    const page = readFileSync("app/dashboard/site-signin/[channel]/page.tsx", "utf8");
    ok("sign-in page shows the account-first hint", page.includes("SITE_SIGNIN_ACCOUNT_FIRST[channel].text"));
    ok("sign-in page passes the window's expiry to the panel", page.includes("expiresAt: (recent.expires_at"));
    const panel = readFileSync("app/dashboard/site-signin/[channel]/window-panel.tsx", "utf8");
    ok("panel shows when the window closes", panel.includes("The window stays open until"));
    const fb = readFileSync("app/dashboard/facebook-connect/page.tsx", "utf8");
    ok("page picker has no token/channel/autopilot jargon", !/Page token|feed channel|autopilot|Distribute tab/.test(fb));
  }

  console.log(`\nsite-signin: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
main();

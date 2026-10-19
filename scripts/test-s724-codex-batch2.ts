// S724 Codex V251 batch 2 (17, 18, 21, 23, 25, 27, 28). Run: npx tsx scripts/test-s724-codex-batch2.ts
import { readFileSync } from "node:fs";
import { siteSigninHref, cleanPropertyId, withQuery } from "../lib/site-signin";
let p = 0, f = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) p++; else { f++; console.log("FAIL", n, JSON.stringify(g ?? "")); } }
const read = (x: string) => readFileSync(x, "utf8");
const id = "db7d147e-cf0b-4339-a52a-abc8a5b92825";

// 18: the rental rides along through sign-in.
ok("href plain", siteSigninHref("rentals_ca") === "/dashboard/site-signin/rentals_ca");
ok("href with rental", siteSigninHref("rentals_ca", id) === `/dashboard/site-signin/rentals_ca?property=${id}`);
ok("junk id dropped", siteSigninHref("rentals_ca", "x' or 1=1") === "/dashboard/site-signin/rentals_ca");
ok("clean id", cleanPropertyId(` ${id.toUpperCase()} `) === id);
ok("withQuery joins", withQuery(siteSigninHref("rentals_ca", id), "err", "save").endsWith("&err=save"));
ok("withQuery first", withQuery("/a", "err", "save") === "/a?err=save");
const signinPage = read("app/dashboard/site-signin/[channel]/page.tsx");
ok("back link keeps the rental", /link-portals\?property=\$\{propertyId\}/.test(signinPage));
ok("form carries the rental", /name="property" value=\{propertyId\}/.test(signinPage));
ok("tiles pass the rental", /siteSigninHref\(row\.channel, propertyId\)/.test(read("app/dashboard/link-portals/view-model.ts")));
ok("link-portals passes it in", /buildLinkPortalsViewModel\(org\.id, locale, ownedPropertyId\)/.test(read("app/dashboard/link-portals/page.tsx")));

// 23: a closed window re-renders the page so Try again shows.
const panel = read("app/dashboard/site-signin/[channel]/window-panel.tsx");
ok("refresh when the window ends", /wasOpen\.current && !siteSigninIsOpen\(win\.status\)[\s\S]{0,120}router\.refresh\(\)/.test(panel));

// 28 + 25: wording on the posting card and the Post box.
const pe = read("app/dashboard/properties/[id]/publish-everywhere.tsx");
ok("getting it ready until approved", /gate === "queued" \|\| gate === "submitting" \|\| gate === "submitted"\)[\s\S]{0,60}item\?\.approved !== true/.test(pe));
ok("no fake site count", !/instantDestinations\.length \+ 2/.test(pe) && /Your Vacantless page goes live now/.test(pe));
ok("email row says who gets it", /New inquiries emailed to you/.test(pe) && !/Email alerts/.test(pe));

// 17: success banner follows the real state.
const billing = read("app/dashboard/billing/page.tsx");
ok("banner says active once active", /view\.isPaid && !addonPending[\s\S]{0,120}is active\./.test(billing));

// 27: robot sites count toward the details from the start.
const page = read("app/dashboard/properties/[id]/page.tsx");
ok("robot sites in the packet", /robotPortalChannels[\s\S]{0,400}isRobotPostedChannel\(key\)/.test(page) && /\.\.\.robotPortalChannels/.test(page));

// 21: every photo control names its photo.
const pm = read("app/dashboard/properties/[id]/photo-manager.tsx");
ok("photo alt", /alt=\{`Photo \$\{i \+ 1\}/.test(pm) && !/alt=""/.test(pm));
ok("controls name the photo", /Move photo \$\{i \+ 1\} earlier/.test(pm) && /Delete photo \$\{i \+ 1\}/.test(pm) && /Set photo \$\{i \+ 1\} as cover/.test(pm));

console.log(`s724-codex-batch2: ${p} passed, ${f} failed`);
if (f) process.exit(1);

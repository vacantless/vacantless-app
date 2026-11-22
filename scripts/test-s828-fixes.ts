// S828: the Glenrose fix list (pets on Add rental, site rows name what is
// missing, touch-up scope, posting now on the Rentals row, Kijiji sign-up off
// the secure window, Professional rentals on Kijiji).
// Run: npx tsx scripts/test-s828-fixes.ts
import { readFileSync } from "node:fs";
import { firstRunCostLine } from "../lib/distribution-channels";
import { postingNowByProperty, postingNowLabel, POSTING_NOW_WINDOW_MS } from "../lib/rental-list-view";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

// (a) pets in the main part of Add rental
const add = readFileSync("app/dashboard/properties/new/add-property-form.tsx", "utf8");
const petsSection = add.indexOf("Pets <span");
const firstDetails = add.indexOf("<details");
ok("a: Pets section exists, marked needed for rental sites", petsSection > 0 && add.includes("· needed for rental sites</span>", petsSection));
ok("a: Pets section sits before the folded sections", petsSection > 0 && petsSection < firstDetails);
ok("a: cats and dogs selects live in it", add.indexOf('["pets_cats", "Cats"]') > petsSection && add.indexOf('["pets_cats", "Cats"]') < firstDetails);
ok("a: only one cats select", add.split('["pets_cats", "Cats"]').length === 2);

// (b) site rows name what is missing
const pe = readFileSync("app/dashboard/properties/[id]/publish-everywhere.tsx", "utf8");
const dt = readFileSync("app/dashboard/properties/[id]/distribute-tab.tsx", "utf8");
ok("b: row says Needs: ...", pe.includes("Needs: {blockedNeeds.join(\", \")}."));
ok("b: blocker carries the plain-word needs", dt.includes("needs: listingPacket.missingRequired.map((m) => m.label.toLowerCase())"));
ok("b: rows get the needs", pe.includes("blockedNeeds={postingBlocker?.needs ?? []}"));

// (c) touch-up box scope
const detail = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
ok("c: touch-up names folder photos only", detail.includes("Touch up the photos this folder brings in") && detail.includes("Photos you upload yourself are left as they are."));

// (d) posting now
const now = Date.parse("2026-11-22T00:00:00Z");
const m = postingNowByProperty(
  [
    { propertyId: "p1", channel: "kijiji", mode: "concierge", publishStatus: "queued", approved: false, updatedAt: null },
    { propertyId: "p1", channel: "zumper", mode: "concierge", publishStatus: "needs_operator", approved: true, updatedAt: new Date(now - 5 * 60_000).toISOString() },
    { propertyId: "p2", channel: "kijiji", mode: "concierge", publishStatus: "needs_operator", approved: true, updatedAt: new Date(now - POSTING_NOW_WINDOW_MS - 1).toISOString() },
    { propertyId: "p3", channel: "kijiji", mode: "concierge", publishStatus: "needs_operator", approved: false, updatedAt: new Date(now).toISOString() },
    { propertyId: "p4", channel: "kijiji", mode: "manual", publishStatus: "queued", approved: false, updatedAt: null },
  ],
  now,
);
ok("d: queued counts as posting", m.get("p1")?.has("kijiji") === true);
ok("d: approved and fresh counts as posting", m.get("p1")?.has("zumper") === true);
ok("d: approved but an hour stale does not", !m.has("p2"));
ok("d: waiting on the landlord does not", !m.has("p3"));
ok("d: not a robot item does not", !m.has("p4"));
ok("d: label one site", postingNowLabel(["kijiji"]) === "Posting to Kijiji");
ok("d: label two sites", postingNowLabel(["kijiji", "zumper"]) === "Posting to Kijiji and Zumper");
const list = readFileSync("app/dashboard/properties/page.tsx", "utf8");
ok("d: row drops posting sites from Post to", list.includes("missingAll.filter((k) => !posting.has(k))"));
ok("d: row shows the Posting chip", list.includes("{postingNowLabel(v.postingNowSites)}"));

// (f) Kijiji sign-up off the secure window
const signin = readFileSync("app/dashboard/site-signin/[channel]/page.tsx", "utf8");
ok("f: Kijiji gets the kijiji.ca sign-up link", signin.includes('channel === "kijiji"') && signin.includes("https://www.kijiji.ca/register/personal"));
ok("f: the fill-for-me form is for the other sites", signin.includes('channel !== "kijiji" && (\n        <form action={startSiteSignin}'));

// (h) Professional rental on Kijiji
const pro = firstRunCostLine("kijiji", { professional: true }) ?? "";
ok("h: professional line names the fee and no free ad", /one free basic ad per account/.test(pro) && /\$33\.84/.test(pro) && /checkout/.test(pro));
ok("h: owner line unchanged", firstRunCostLine("kijiji") === "1 free ad per personal account, then $33.84 each.");
ok("h: other sites ignore the flag", firstRunCostLine("zumper", { professional: true }) === firstRunCostLine("zumper"));
ok("h: the row passes the rental's Listed by", pe.includes('listedByProfessional={String(basics.forRentBy ?? "").toLowerCase() === "professional"}') && pe.includes("listedByProfessional={listedByProfessional}"));

// S828b: a rental the login cannot open says which login this is
const signout = readFileSync("app/auth/signout/route.ts", "utf8");
ok("wrong account: no bare not found when signed in", detail.includes("This rental is in another account") && detail.includes("if (!viewer) notFound();"));
ok("wrong account: demo login is named", detail.includes("This is the demo account."));
ok("wrong account: sign out comes back to the rental", detail.includes('name="next" value={`/dashboard/properties/${params.id}?tab=distribute`}') && signout.includes('target.searchParams.set("next", next)') && signout.includes("safeNextPath(raw)"));

console.log(`\ns828-fixes: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

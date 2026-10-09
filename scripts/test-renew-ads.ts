// Run with: npx tsx scripts/test-renew-ads.ts
// S702g: "I renewed it today" only touches LIVE ads for one site on one rental,
// dates them in the org's timezone, and the card only lists old ads with a link.
import { readFileSync } from "node:fs";
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}
const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
const start = actions.indexOf("export async function markAdsRenewed");
const body = actions.slice(start, actions.indexOf("export async function", start + 10));
ok("action exists", start > 0);
ok("needs manage_properties", body.includes('requireCapability("manage_properties"'));
ok("scoped to the rental", body.includes('.eq("property_id", propertyId)'));
ok("scoped to one site", body.includes('.eq("portal", portal)'));
ok("only live ads", body.includes('.eq("status", "live")'));
ok("org timezone date", body.includes("localDateString(") && body.includes("booking_timezone"));
ok("only posted_on changes", body.includes(".update({ posted_on: today })"));

const page = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
ok("card only lists old ads", page.includes('c.status.value === "needs_refresh" && c.status.liveUrl'));
ok("page ages blank dates from created_at", page.includes("rawPosts[i].created_at.slice(0, 10)"));
ok("renewed flash", page.includes('searchParams.post === "renewed"'));

const card = readFileSync("app/dashboard/properties/[id]/renew-ads-card.tsx", "utf8");
ok("no em dash", !card.includes("—"));
ok("renew-and-open button", card.includes('name="then" value="open"') && card.includes("Renew on {item.label}"));
ok("already-renewed button", card.includes("I already renewed it"));
ok("redirect uses the saved ad url, not the form", body.includes('.select("url")') && !body.includes('formData.get("url")'));
ok("redirect only to facebook or kijiji", body.includes("facebook") && body.includes("kijiji"));

console.log(`\nrenew-ads: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

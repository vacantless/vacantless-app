// Run with: npx tsx scripts/test-page-weekly-posts.ts
import { readFileSync } from "node:fs";
import { duePageReposts } from "../lib/page-weekly-posts";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const today = "2026-10-09";
const prop = (id: string, status = "available", archivedAt: string | null = null) => ({ id, status, archivedAt });
const post = (propertyId: string, postedOn: string | null, status = "live", createdAt: string | null = null) => ({ propertyId, status, postedOn, createdAt });

ok("never posted is due", duePageReposts({ properties: [prop("a")], posts: [], today }).join() === "a");
ok("posted 6 days ago is not due", duePageReposts({ properties: [prop("a")], posts: [post("a", "2026-10-03")], today }).length === 0);
ok("posted 7 days ago is due", duePageReposts({ properties: [prop("a")], posts: [post("a", "2026-10-02")], today }).join() === "a");
ok("newest post wins", duePageReposts({ properties: [prop("a")], posts: [post("a", "2026-09-01"), post("a", "2026-10-08")], today }).length === 0);
ok("removed posts ignored", duePageReposts({ properties: [prop("a")], posts: [post("a", "2026-10-08", "removed")], today }).join() === "a");
ok("blank posted date uses created_at", duePageReposts({ properties: [prop("a")], posts: [post("a", null, "live", "2026-10-08T15:00:00Z")], today }).length === 0);
ok("leased rentals skipped", duePageReposts({ properties: [prop("a", "leased")], posts: [], today }).length === 0);
ok("drafts skipped", duePageReposts({ properties: [prop("a", "draft")], posts: [], today }).length === 0);
ok("archived skipped", duePageReposts({ properties: [prop("a", "available", "2026-10-01")], posts: [], today }).length === 0);
const order = duePageReposts({
  properties: [prop("old"), prop("never"), prop("older")],
  posts: [post("old", "2026-09-30"), post("older", "2026-09-20")],
  today,
});
ok("never first, then oldest", order.join() === "never,older,old");
ok("cap respected", duePageReposts({ properties: [prop("a"), prop("b"), prop("c")], posts: [], today, max: 2 }).length === 2);

const route = readFileSync("app/api/cron/page-weekly-posts/route.ts", "utf8");
ok("route needs CRON_SECRET", route.includes("CRON_SECRET"));
ok("route only for opted-in orgs", route.includes('.eq("page_weekly_posts", true)'));
ok("route needs a connected Page", route.includes('account_status !== "connected"'));
ok("route skips quiet test orgs", route.includes("isQuietNotificationOrg"));
ok("route marks reconnect on auth error", route.includes('account_status: "needs_login"'));
ok("route has a dry run", route.includes('get("dry") === "1"'));

const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
const s = actions.indexOf("export async function setPageWeeklyPosts");
const body = actions.slice(s, actions.indexOf("export async function", s + 10));
ok("toggle exists", s > 0);
ok("toggle needs manage_properties", body.includes('requireCapability("manage_properties"'));
ok("toggle on needs a connected Page", body.includes('"connected"'));

console.log(`\npage-weekly-posts: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

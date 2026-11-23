// S836d: for rent, no ads up. Run: npx tsx scripts/test-s836d-ads-down.ts
import { readFileSync } from "node:fs";
import { adsDownUnit, downReason, rentedSign, type AdPost } from "../lib/ads-down";
import { buildAccountReport } from "../lib/account-report";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}${extra !== undefined ? ` ${JSON.stringify(extra)}` : ""}`);
  }
}

const unit = { propertyId: "p1", address: "50 Glenrose Ave, Unit 4", status: "available" };
const post = (o: Partial<AdPost>): AdPost => ({ portal: "kijiji", status: "removed", notes: null, downAt: null, ...o });

// Why an ad came down, from the notes our code writes.
ok("you took it down", downReason(post({ notes: "Taken down by noam@x.com on 2026-11-20 (marked in Vacantless)." })) === "you_took_down");
ok("Vacantless took it down", downReason(post({ notes: "Taken down by Vacantless on 2026-11-06 (Facebook Page post deleted)." })) === "you_took_down");
ok("live check found it gone", downReason(post({ notes: "live-check 2026-11-01 09:00: REMOVED (redirect). Row flipped live -> removed" })) === "site_removed");
ok("Facebook removed it", downReason(post({ portal: "facebook", notes: "2026-11-02: Facebook removed this ad (seen by the Vacantless helper)." })) === "site_removed");
ok("Kijiji expired (old note)", downReason(post({ status: "expired", notes: "flipped live -> expired. Kijiji ad no longer exists: adRemoved=1" })) === "expired");
ok("expired status", downReason(post({ status: "expired" })) === "expired");
ok("no note", downReason(post({})) === "unknown");

// Only units still for rent with every ad down.
ok("an ad still live: not listed", adsDownUnit(unit, [post({}), post({ status: "live" })], {}) === null);
ok("never had an ad: not listed", adsDownUnit(unit, [post({ status: "draft" })], {}) === null);
ok("marked rented: not listed", adsDownUnit({ ...unit, status: "leased" }, [post({})], {}) === null);

// 50 Glenrose Unit 4 as it is today.
const glen = adsDownUnit(
  unit,
  [
    post({ status: "expired", notes: "flipped live -> expired. Kijiji ad no longer exists: adRemoved=1" }),
    post({ portal: "facebook", status: "expired" }),
    post({ portal: "zumper", status: "removed", notes: "S684: re-published by hand" }),
    post({ portal: "rentals_ca", status: "draft" }),
  ],
  {},
);
ok("glenrose: ads expired", glen?.verdict === "ads_expired", glen);
ok("glenrose line", glen?.line === "Ads expired on Kijiji and Facebook Marketplace, still marked for rent. Repost it, or mark it rented.", glen?.line);

// Signs it rented, strongest first.
ok("tenancy beats all", rentedSign({ hasTenancy: true, tenancyStart: "2026-12-01", offerAcceptedAt: "2026-11-20T10:00:00Z" }) === "a tenancy starts Dec 1");
ok("offer accepted", rentedSign({ offerAcceptedAt: "2026-11-20T10:00:00Z", applicationSubmittedAt: "2026-11-18T10:00:00Z" }) === "offer accepted Nov 20");
ok("application", rentedSign({ applicationSubmittedAt: "2026-11-18T10:00:00Z" }) === "an application came in Nov 18");
ok("applied renter", rentedSign({ renterAtApplied: true }) === "a renter is at Applied");
ok("nothing", rentedSign({}) === null);

const rented = adsDownUnit(unit, [post({ downAt: "2026-11-21T15:00:00Z", notes: "Taken down by Vacantless on 2026-11-21" })], { offerAcceptedAt: "2026-11-20T10:00:00Z" });
ok("probably rented wins over the takedown reason", rented?.verdict === "probably_rented");
ok("probably rented line with the day it came down", rented?.line === "Probably rented: offer accepted Nov 20. Mark it rented? Last ad down Nov 21.", rented?.line);
const took = adsDownUnit(unit, [post({ portal: "facebook_feed", notes: "Taken down by Vacantless on 2026-11-06 (Facebook Page post deleted)." })], {});
ok("taken down line", took?.line === "Ads taken down (Facebook Page), still marked for rent. Rented? Mark it.", took?.line);
const unk = adsDownUnit(unit, [post({})], {});
ok("unknown line", unk?.verdict === "unknown" && unk.line.startsWith("Ads down, reason not recorded"));
for (const u of [glen, rented, took, unk]) ok("no em dash", !(u?.line ?? "").includes("—"));

// In the monthly summary.
const r = buildAccountReport({
  orgName: "T",
  monthStart: "2026-11-01",
  monthEnd: "2026-12-01",
  today: "2026-12-01",
  properties: [{ id: "p1", address: "50 Glenrose Ave, Unit 4, Toronto, ON", status: "available", availableSince: "2026-09-01" }],
  outcomes: [],
  leads: [],
  showings: [],
  costs: [],
  books: null,
  reportsUrl: "https://app.vacantless.com/dashboard/reports",
  adsDown: [glen!],
  rentalUrl: (id) => `https://app.vacantless.com/dashboard/properties/${id}`,
});
ok("summary section", r.html.includes("For rent, no ads up") && r.html.includes("Ads expired on Kijiji"));
ok("summary links the rental", r.html.includes("/dashboard/properties/p1"));
ok("summary counts it", r.facts.adsDown === 1);
const none = buildAccountReport({ ...{ orgName: "T", monthStart: "2026-11-01", monthEnd: "2026-12-01", today: "2026-12-01", properties: [], outcomes: [], leads: [], showings: [], costs: [], books: null, reportsUrl: "x" } });
ok("no section when none", !none.html.includes("For rent, no ads up"));

// Wiring.
const mig = readFileSync("supabase/migrations/0330_listing_post_down_at.sql", "utf8");
ok("migration adds down_at", mig.includes("add column if not exists down_at timestamptz"));
ok("database keeps the date", mig.includes("before insert or update of status on public.listing_posts") && mig.includes("new.down_at := null"));
ok("migration is additive", !/\bdrop\b/i.test(mig.replace(/--.*$/gm, "")));
const srv = readFileSync("lib/ads-down-server.ts", "utf8");
ok("signs count only since it came on the market", srv.includes("after(t.created_at)") && srv.includes("after(o.accepted_at)") && srv.includes("after(a.submitted_at)") && srv.includes("after(l.created_at)"));
ok("old tenancies ignored", srv.includes('.neq("status", "ended")'));
ok("declined applications ignored", srv.includes('.neq("status", "declined")'));
ok("every read scoped to the account", (srv.match(/\.eq\("organization_id", orgId\)/g) ?? []).length === 6);
ok("Leasing shows it", readFileSync("app/dashboard/leasing/page.tsx", "utf8").includes("For rent, no ads up"));
ok("summary loads it", readFileSync("lib/account-report-server.ts", "utf8").includes("loadAdsDown(db, orgId)"));

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

// S309 regression guard: an off-market unit must render the "no longer
// available" referral page, not a 404.
//
// Background. archiveProperty sets status='off_market'. Before migration 0223
// get_public_listing excluded off_market, so app/r/[propertyId] fell through to
// notFound() and every link already shared for that unit died. The referral UI
// it should have shown was already built and only ever reached by status
// 'leased'. 1551 Assumption St Unit D drew 64 enquiries in 14 days and then
// 404'd all of them.
//
// These are source-level assertions in the style of test-property-archive.ts:
// no database, no network. They fail if anyone re-excludes off_market from the
// two public RPCs, deletes the referral branch, or opens the lead/booking path
// to a non-available unit.
//
// Run: npx tsx scripts/test-offmarket-referral.ts

import { readFileSync, readdirSync } from "fs";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const MIG_DIR = "supabase/migrations";
const migrations = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const referralMigration = migrations.find((f) => f.startsWith("0223_"));
ok("migration 0223 is present", Boolean(referralMigration));

const mig = readFileSync(`${MIG_DIR}/${referralMigration}`, "utf8");

// The two public RPCs must let off_market through and keep draft out.
ok(
  "0223 relaxes get_public_listing to exclude only draft",
  /where p\.id = p_property_id\s*\n\s*and p\.status <> 'draft';/.test(mig),
);
ok(
  "0223 relaxes the sibling source to exclude only draft",
  /where id = p_property_id\s*\n\s*and status <> 'draft'/.test(mig),
);
ok(
  "0223 redefines get_public_listing",
  /create or replace function public\.get_public_listing\(/.test(mig),
);
ok(
  "0223 redefines get_public_leaseup_siblings",
  /create or replace function public\.get_public_leaseup_siblings\(/.test(mig),
);
ok(
  "0223 leaves no off_market exclusion behind in either function",
  !/status not in \('off_market'|status not in \('draft', 'off_market'\)/.test(
    mig,
  ),
);
ok(
  "0223 still grants execute to anon",
  (mig.match(/grant execute on function public\.get_public_(listing|leaseup_siblings)\(uuid\) to anon/g) ||
    []).length === 2,
);

// Nothing after 0223 may quietly put the exclusion back.
const later = migrations.filter((f) => f > (referralMigration ?? "0223"));
for (const f of later) {
  const body = readFileSync(`${MIG_DIR}/${f}`, "utf8");
  const touchesRpc =
    /create or replace function public\.get_public_listing\(/.test(body) ||
    /create or replace function public\.get_public_leaseup_siblings\(/.test(body);
  if (!touchesRpc) continue;
  ok(
    `${f} does not re-exclude off_market from the public RPCs`,
    !/status not in \('off_market'|'off_market'\)/.test(body),
  );
}

// The page must keep the referral branch and 404 only on a missing listing.
const page = readFileSync("app/r/[propertyId]/page.tsx", "utf8");
ok(
  "public page 404s only when the RPC returns nothing",
  page.includes("if (!listing) notFound();"),
);
ok(
  "public page still derives isAvailable from status === 'available'",
  page.includes(`const isAvailable = l.status === "available";`),
);
ok(
  "public page keeps the gone-state heading",
  page.includes("This rental is no longer available"),
);
ok(
  "public page keeps the open-sibling list",
  page.includes("Available now") && page.includes("displayOpenSiblings.map"),
);
ok(
  "public page keeps the waitlist fallback",
  page.includes("joinWaitlist"),
);
ok(
  "public page keeps the gone-state behind !isAvailable",
  page.includes("{!isAvailable ? ("),
);
ok(
  "public page noindexes anything that is not available",
  /if \(listing\.status !== "available"\) \{\s*\n\s*metadata\.robots = \{ index: false \};/.test(
    page,
  ),
);

// The TypeScript status contract must mirror the RPC, or the dashboard will keep
// telling operators that archiving returns a not-found page.
const listingState = readFileSync("lib/listing-state.ts", "utf8");
ok(
  "isPubliclyVisible hides draft and only draft",
  /export function isPubliclyVisible\(status: string\): boolean \{\n  return status !== "draft";/.test(
    listingState,
  ),
);
ok(
  "the operator help text for off-market matches the new behaviour",
  /off_market: "Retired\. The public link still opens/.test(listingState),
);

// The write path must stay closed. Rendering a gone page must never make a
// non-available unit bookable or inquirable.
const leadGuard = migrations
  .map((f) => readFileSync(`${MIG_DIR}/${f}`, "utf8"))
  .filter((body) =>
    /create or replace function public\.submit_public_lead\(/.test(body),
  )
  .pop();
ok("a submit_public_lead definition exists", Boolean(leadGuard));
ok(
  "submit_public_lead still requires status = 'available'",
  Boolean(leadGuard && /status = 'available'/.test(leadGuard)),
);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

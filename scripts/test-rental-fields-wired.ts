// Run with: npx tsx scripts/test-rental-fields-wired.ts
// S712: rental fields that were saved but never seen are now edited, shown to
// renters, fed to the feed and ad copy. Pure checks for the new helpers plus
// wiring checks for each surface.
import { readFileSync } from "node:fs";
import {
  buildGoodToKnow,
  formatDollarsFromCents,
  heatingTypeLabel,
  safeHttpUrl,
  buildAmenityChips,
} from "../lib/property-features";
import { buildListingItemXml, type FeedListingInput } from "../lib/listing-feed";
import { buildListingCopy, listingFactsLine } from "../lib/listing-copy";
import { matchesVacancy } from "../lib/waitlist";

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

// ---- pure helpers -----------------------------------------------------------
ok("money: whole dollars", formatDollarsFromCents(125000) === "$1,250");
ok("money: cents shown", formatDollarsFromCents(125050) === "$1,250.50");
ok("money: zero is $0", formatDollarsFromCents(0) === "$0");
ok("money: null", formatDollarsFromCents(null) === null);
ok("money: negative", formatDollarsFromCents(-100) === null);
ok("heating label", heatingTypeLabel("forced_air") === "Forced air");
ok("heating unknown", heatingTypeLabel("lava") === null);

ok("url: https ok", safeHttpUrl("https://youtu.be/abc") === "https://youtu.be/abc");
ok("url: http ok", safeHttpUrl(" http://example.com/v ") === "http://example.com/v");
ok("url: javascript blocked", safeHttpUrl("javascript:alert(1)") === null);
ok("url: data blocked", safeHttpUrl("data:text/html,hi") === null);
ok("url: relative blocked", safeHttpUrl("/r/abc") === null);
ok("url: blank", safeHttpUrl("  ") === null && safeHttpUrl(null) === null);

const g = buildGoodToKnow({
  heating_type: "baseboard",
  security_deposit_cents: 127500,
  income_requirement: " 3x rent ",
  parking_type: "outdoor",
  parking_count: 1,
});
ok("good to know: order", g.map((f) => f.label).join("|") === "Heating|Deposit|Income requirement|Parking");
ok("good to know: deposit in dollars", g[1].value === "$1,275");
ok("good to know: income trimmed", g[2].value === "3x rent");
ok("good to know: parking", g[3].value === "1 outdoor parking space");
ok("good to know: empty", buildGoodToKnow({}).length === 0);
ok("good to know: parking falls back to text", buildGoodToKnow({ parking: "1 spot" })[0]?.value === "1 spot");
ok("good to know: junk heating skipped", buildGoodToKnow({ heating_type: "x" }).length === 0);
ok("chips: amenities merge", buildAmenityChips({ amenities: ["dishwasher", "gym"] }).includes("Dishwasher"));

// ---- feed -------------------------------------------------------------------
const feedListing: FeedListingInput = {
  id: "P1",
  address: "1 Main St",
  rent_cents: 150000,
  beds: 2,
  baths: 1,
  description: "A bright two bedroom with a big kitchen and lots of light.",
  photos: ["https://x/1.jpg"],
  heating_type: "radiant",
  security_deposit_cents: 150000,
};
const xml = buildListingItemXml(feedListing, { baseUrl: "https://app", country: "CA" });
ok("feed: heating_type", xml.includes("<heating_type>radiant</heating_type>"));
ok("feed: deposit like rent", xml.includes('<security_deposit currency="CAD">1500.00</security_deposit>'));
const xmlBare = buildListingItemXml({ ...feedListing, heating_type: "junk", security_deposit_cents: null }, { baseUrl: "https://app", country: "CA" });
ok("feed: unknown heating skipped", !xmlBare.includes("heating_type"));
ok("feed: no deposit skipped", !xmlBare.includes("security_deposit"));

// ---- ad copy ----------------------------------------------------------------
ok("copy facts line", listingFactsLine({ heating_type: "heat_pump", security_deposit_cents: 99500 }) === "Heating: Heat pump. Deposit: $995.");
ok("copy facts line empty", listingFactsLine({}) === null);
const copy = buildListingCopy({ address: "1 Main St", rentCents: 150000, features: { heating_type: "boiler", security_deposit_cents: 150000 } }, "kijiji");
ok("copy: body has heating + deposit", copy.body.includes("Heating: Boiler.") && copy.body.includes("Deposit: $1,500."));
ok("copy: no em dash", !copy.body.includes("—"));

// ---- waitlist ---------------------------------------------------------------
ok(
  "waitlist: move-in date excludes a later vacancy",
  !matchesVacancy(
    { status: "active", property_id: null, beds_min: null, max_rent_cents: null, last_notified_property_id: null, move_in_by: "2026-10-31" },
    { id: "P1", status: "available", beds: 1, rent_cents: 1, available_date: "2026-11-01" },
  ),
);

// ---- wiring -----------------------------------------------------------------
const actions = read("app/dashboard/properties/actions.ts");
const updateBody = actions.slice(actions.indexOf("export async function updateProperty"), actions.indexOf("async function publishAuthorizedInstantChannelsAfterPageLive"));
ok("1 update: heating", updateBody.includes('heating_type: normalizeHeatingType(formData.get("heating_type"))'));
ok("1 update: parking type", updateBody.includes('parking_type: normalizeParkingType(formData.get("parking_type"))'));
ok("1 update: parking count", updateBody.includes('parking_count: parseNonNegativeInt(String(formData.get("parking_count") ?? ""))'));
ok("1 update: deposit", updateBody.includes('String(formData.get("security_deposit") ?? "")'));
ok("1 update: income", updateBody.includes('income_requirement: textOrNull(formData.get("income_requirement"))'));
ok("1 update: video", updateBody.includes("video_url: videoUrl") && updateBody.includes("videoerr=host"));
ok("4 update: photos_ready no longer written", !updateBody.includes("photos_ready"));
ok("4 duplicate copy untouched", actions.includes("clonedCount > 0 && clonedCount === sourcePhotos.length && s.photos_ready"));

const page = read("app/dashboard/properties/[id]/page.tsx");
for (const name of ["heating_type", "security_deposit", "income_requirement", "video_url", "parking_type", "parking_count"]) {
  ok(`1 edit form: ${name} input`, page.includes(`name="${name}"`));
}
ok("1 edit form: shared option lists", page.includes("HEATING_TYPE_OPTIONS.map") && page.includes("PARKING_TYPE_OPTIONS.map"));
ok("1 edit form: deposit shown in dollars", page.includes("p.security_deposit_cents / 100"));
ok("4 edit form: photos_ready checkbox gone", !page.includes('name="photos_ready"') && !page.includes("Listing photos ready"));
ok("5 page: passes move_in_by + available_date", page.includes("move_in_by: e.move_in_by") && page.includes("available_date: p.available_date,"));
ok("3 page: copy features carry heating + deposit", page.includes("heating_type: p.heating_type") && page.includes("security_deposit_cents: p.security_deposit_cents"));

const wl = read("app/dashboard/properties/[id]/waitlist-actions.ts");
ok("5 notify: selects move_in_by", /max_rent_cents, move_in_by,/.test(wl));
ok("5 notify: vacancy has available_date", wl.includes("rent_cents, address, available_date") && wl.includes("available_date: (prop.available_date"));

const pub = read("app/r/[propertyId]/page.tsx");
ok("2 public: narrow column list", pub.includes('"heating_type, security_deposit_cents, income_requirement, parking_type, parking_count, amenities, video_url"'));
ok("2 public: extras only when available", /if \(isAvailable\) \{\s*const admin = createAdminClient\(\);/.test(pub));
ok("2 public: good to know block", pub.includes("Good to know") && pub.includes("buildGoodToKnow("));
ok("2 public: amenities merged", pub.includes("amenities: extras?.amenities"));
ok("2 public: video link is safe-checked", pub.includes("safeHttpUrl(extras?.video_url)"));

const feed = read("lib/listing-feed.ts");
ok("3 feed: heating + deposit emitted", feed.includes('tag("heating_type"') && feed.includes("<security_deposit currency=\"CAD\">"));

const settings = read("app/dashboard/settings/page.tsx");
ok("6 settings: reference-only note", settings.includes("For your records. We don&apos;t use these to post."));

const qa = read("app/dashboard/leads/property-qa-panel.tsx");
const reply = read("app/dashboard/leads/inquiry-reply-panel.tsx");
const ent = read("lib/feature-entitlements.ts");
ok("7 qa panel: no AI claim", !/\bAI\b/.test(qa) && qa.includes("Answers for reply drafts") && qa.includes("Reply drafts are off"));
ok("7 reply panel: heading reference", reply.includes("Answers for reply drafts") && !reply.includes("Answers the AI can use"));
ok("7 entitlements: description", ent.includes("Adds the reply draft helper to renter inquiry replies."));
ok("7 real AI left alone", read("lib/ai-enquiry-server.ts").length > 0);

console.log(`\nrental-fields-wired: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

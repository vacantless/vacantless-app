// S736 (review item 9): the Marketplace kit on the landlord's phone. Signed
// phone link, share-link reading, facts, photo links, the email copy, wiring.
// Run: npx tsx scripts/test-marketplace-phone.ts
import { readFileSync } from "node:fs";
import {
  MARKETPLACE_KIT_MAX_PHOTOS,
  MARKETPLACE_PHONE_LINK_DAYS,
  isFacebookShareLink,
  isOwnPhotoBucketUrl,
  marketplaceItemUrlFrom,
  marketplaceKitFacts,
  marketplaceKitPhotoUrls,
  marketplacePhoneKitPath,
} from "../lib/marketplace-kit";
import { phoneKitSecret, signPhoneKitToken, verifyPhoneKitToken } from "../lib/marketplace-phone-link";
import { phoneKitEmail } from "../lib/marketplace-phone-email";
import { isFacebookMarketplaceListingUrl } from "../lib/listing-distribution";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const PROP = "1e0b8243-0000-4000-8000-000000000001";
const ORG = "921f7c08-98af-4000-8000-000000000002";
const SECRET = "test-secret";
const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const DAY = 86_400_000;

// --- signed phone link ---
const tok = signPhoneKitToken({ propertyId: PROP, orgId: ORG, nowMs: NOW }, SECRET);
ok("token is made", tok.startsWith(`m-${PROP}-${ORG}-`) && tok.includes("."));
const good = verifyPhoneKitToken(tok, SECRET, NOW);
ok("token verifies", good.ok && good.subject.propertyId === PROP && good.subject.orgId === ORG);
ok("still works on the last day", verifyPhoneKitToken(tok, SECRET, NOW + MARKETPLACE_PHONE_LINK_DAYS * DAY).ok);
const old = verifyPhoneKitToken(tok, SECRET, NOW + (MARKETPLACE_PHONE_LINK_DAYS + 1) * DAY);
ok("too old after the last day", !old.ok && old.reason === "too_old");
const wrongSecret = verifyPhoneKitToken(tok, "other", NOW);
ok("other secret is refused", !wrongSecret.ok && wrongSecret.reason === "bad");
const otherProp = tok.replace(PROP, "1e0b8243-0000-4000-8000-000000000009");
ok("swapped rental is refused", !verifyPhoneKitToken(otherProp, SECRET, NOW).ok);
const longer = tok.replace(/-(\d+)\./, (_m, d) => `-${Number(d) + 100}.`);
ok("stretched last day is refused", !verifyPhoneKitToken(longer, SECRET, NOW).ok);
ok("uppercase copy still verifies", verifyPhoneKitToken(tok.toUpperCase(), SECRET, NOW).ok);
ok("garbage is refused", !verifyPhoneKitToken("hello", SECRET, NOW).ok && !verifyPhoneKitToken(null, SECRET, NOW).ok);
ok("no secret, no token", signPhoneKitToken({ propertyId: PROP, orgId: ORG, nowMs: NOW }, "") === "");
ok("no secret, nothing verifies", !verifyPhoneKitToken(tok, "", NOW).ok);
ok("secret from the service key", phoneKitSecret({ SUPABASE_SERVICE_ROLE_KEY: "a", CRON_SECRET: "b" }) === "a");
ok("secret falls back to the cron secret", phoneKitSecret({ CRON_SECRET: "b" }) === "b");
ok("phone kit path", marketplacePhoneKitPath("m-a.b") === "/kit/m-a.b");

// --- share links from the Facebook app ---
ok("share link /share/<code>/", isFacebookShareLink("https://www.facebook.com/share/1AbC2dEf3G/"));
ok("share link /share/p/<code>/", isFacebookShareLink("https://www.facebook.com/share/p/1AbC2dEf3G/"));
ok("share link on m.", isFacebookShareLink("https://m.facebook.com/share/1AbC2dEf3G"));
ok("fb.me short link", isFacebookShareLink("https://fb.me/abc123"));
ok("an item link is not a share link", !isFacebookShareLink("https://www.facebook.com/marketplace/item/1234567890/"));
ok("a profile is not a share link", !isFacebookShareLink("https://www.facebook.com/noam.m"));
ok("another site is not a share link", !isFacebookShareLink("https://evil.example/share/abc/"));
ok("a lookalike host is not a share link", !isFacebookShareLink("https://facebook.com.evil.example/share/abc/"));
ok("junk is not a share link", !isFacebookShareLink("not a url") && !isFacebookShareLink(null));

// --- reading the ad's own link ---
ok("from a Location", marketplaceItemUrlFrom("https://www.facebook.com/marketplace/item/1218512567595763/?mibextid=abc") === "https://www.facebook.com/marketplace/item/1218512567595763/");
ok("from a canonical tag", marketplaceItemUrlFrom('<link rel="canonical" href="https://www.facebook.com/marketplace/item/1636645884466891/" />') === "https://www.facebook.com/marketplace/item/1636645884466891/");
ok("from escaped JSON", marketplaceItemUrlFrom('"url":"https:\\/\\/www.facebook.com\\/marketplace\\/item\\/1636645884466891\\/"') === "https://www.facebook.com/marketplace/item/1636645884466891/");
ok("nothing when absent", marketplaceItemUrlFrom("https://www.facebook.com/login/") === null && marketplaceItemUrlFrom(null) === null);
ok("short ids are not ads", marketplaceItemUrlFrom("facebook.com/marketplace/item/123/") === null);
ok("what it returns passes the save check", isFacebookMarketplaceListingUrl(marketplaceItemUrlFrom("facebook.com/marketplace/item/1218512567595763")));

// --- facts ---
const facts = marketplaceKitFacts({ rent_cents: 175000, beds: 2, baths: 1, sqft: null, address: "506 Manning Ave", available_date: null });
ok("facts: price", facts[0].label === "Price per month" && facts[0].value === "$1,750");
ok("facts: no square feet when unknown", !facts.some((f) => f.label === "Square feet"));
ok("facts: available is last", facts[facts.length - 1].label === "Available");

// --- photo links ---
const BASE = "https://nvh.supabase.co";
const own = `${BASE}/storage/v1/object/public/property-photos/a/1.jpg`;
ok("own bucket", isOwnPhotoBucketUrl(own, BASE) && isOwnPhotoBucketUrl(own, `${BASE}/`));
ok("other bucket refused", !isOwnPhotoBucketUrl(`${BASE}/storage/v1/object/public/other/a.jpg`, BASE));
ok("no base refused", !isOwnPhotoBucketUrl(own, ""));
const many = Array.from({ length: 40 }, (_, i) => `${BASE}/storage/v1/object/public/property-photos/a/${i}.jpg`);
const picked = marketplaceKitPhotoUrls(["https://elsewhere.example/x.jpg", ...many], BASE);
ok("photo links: ours only, in order, capped", picked.length === MARKETPLACE_KIT_MAX_PHOTOS && picked[0] === many[0]);

// --- email copy ---
const mail = phoneKitEmail({ address: "1551 Assumption St Unit 9" });
ok("email subject names the rental", mail.subject.includes("1551 Assumption St Unit 9"));
ok("email says how long the link works", mail.body.includes(`${MARKETPLACE_PHONE_LINK_DAYS} days`));
ok("email without an address", phoneKitEmail({ address: null }).body.includes("your rental"));
ok("email has no em dash", !/\u2014/.test(mail.subject + mail.body));

// --- wiring ---
const read = (f: string) => readFileSync(f, "utf8");
const page = read("app/kit/[token]/page.tsx");
ok("phone page reads no renter data", !/from\("leads"\)/.test(page));
ok("phone page is kept out of search", page.includes("index: false"));
ok("phone page checks the signed link", page.includes("loadPhoneMarketplaceContext(admin, params.token"));
ok("phone page passes the photo links", page.includes("photoUrls={photoUrls}"));
const actions = read("app/kit/[token]/actions.ts");
ok("phone save re-checks the link", actions.includes("loadPhoneMarketplaceContext(admin, token"));
ok("phone save uses the token's account", actions.includes("orgId: loaded.ctx.orgId"));
const photos = read("app/kit/[token]/photos/route.ts");
ok("phone zip checks the link", photos.includes("loadPhoneMarketplaceContext"));
const server = read("lib/marketplace-kit-server.ts");
ok("phone context scopes the rental to the token's account", server.includes("loadKitRental(admin, orgId, propertyId)"));
ok("record resolves share links", server.includes("await resolveMarketplaceAdUrl(input.url)"));
ok("resolver stays on Facebook", server.includes("facebook\\.com|fb\\.me"));
ok("resolver has a time limit", server.includes("AbortSignal.timeout("));
const landlordSave = read("app/dashboard/properties/actions.ts");
ok("landlord save resolves share links for Marketplace", landlordSave.includes('portal === "facebook" ? await resolveMarketplaceAdUrl(rawUrl) : rawUrl'));
const mailAction = read("app/dashboard/properties/[id]/marketplace-actions.ts");
const mailFn = mailAction.slice(mailAction.indexOf("export async function emailMarketplacePhoneLink"));
ok("email action checks capability", mailFn.includes('requireCapability("manage_properties"'));
ok("email action scopes the rental to the org", mailFn.includes('.eq("organization_id", org.id)'));
ok("email goes to the signed-in person only", mailFn.includes("to_email: to") && mailFn.includes("user?.email"));
const steps = read("components/marketplace-kit-steps.tsx");
ok("steps share the photos on a phone", steps.includes("navigator.share({ files })"));
ok("steps fall back to a grid", steps.includes('setMode("grid")'));
ok("steps keep the zip on a computer", steps.includes("Download {photoCount} photo"));
const row = read("app/dashboard/properties/[id]/marketplace-row.tsx");
ok("row shows the phone code on computers only", row.includes("hidden rounded-lg") && row.includes("md:flex"));
ok("robots keep the phone pages out", read("app/robots.ts").includes('"/kit"'));

console.log(`\nmarketplace-phone: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// S805: "Check Renew on Marketplace" opens Your listings on a computer and the
// ad itself on a phone (Your listings is a dead search in the Facebook app).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { facebookRenewHref, FACEBOOK_YOUR_LISTINGS } from "../lib/facebook-renew";
import { isPhoneUserAgent } from "../lib/sites-phone";

let n = 0;
const ok = (name: string, c: unknown) => {
  n++;
  assert.ok(c, name);
};
const ad = "https://www.facebook.com/marketplace/item/2199071007336827/";
ok("computer: Your listings", facebookRenewHref(ad, false) === FACEBOOK_YOUR_LISTINGS);
ok("computer without an ad: Your listings", facebookRenewHref(null, false) === FACEBOOK_YOUR_LISTINGS);
ok("phone: the ad itself", facebookRenewHref(ad, true) === ad);
ok("phone, m. link", facebookRenewHref("https://m.facebook.com/marketplace/item/123", true) === "https://m.facebook.com/marketplace/item/123");
ok("phone without an ad: nothing", facebookRenewHref(null, true) === null);
ok("phone never follows a non-Facebook link", facebookRenewHref("https://evil.example/marketplace/item/1", true) === null);
ok("phone never follows a Facebook non-item link", facebookRenewHref("https://www.facebook.com/marketplace/you/selling", true) === null);
ok("iPhone is a phone", isPhoneUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15"));
ok("Mac Chrome is not", !isPhoneUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131"));
for (const f of [
  "app/dashboard/properties/page.tsx",
  "app/dashboard/properties/[id]/publish-everywhere.tsx",
  "app/dashboard/properties/[id]/keep-fresh-card.tsx",
]) {
  const src = readFileSync(f, "utf8");
  ok(`${f} uses the shared link`, src.includes("<FacebookRenewLink"));
  ok(`${f} has no hard-coded Your listings link`, !src.includes("marketplace/you/selling"));
}
console.log(`PASS test-facebook-renew-link (${n} checks)`);

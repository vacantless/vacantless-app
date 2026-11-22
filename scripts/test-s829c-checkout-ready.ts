// S829c: the "ready to pay" email when a paid ad waits at a site's checkout,
// one reminder after 4 hours, and the approve dialog says the wait.
// Run: npx tsx scripts/test-s829c-checkout-ready.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHECKOUT_REMIND_AFTER_MS, checkoutReadyAction, checkoutReadyEmail } from "../lib/checkout-ready";
import { siteCheckoutUrl, KIJIJI_MY_ADS_URL } from "../lib/distribution-publish";
import { SWEEP_PATHS } from "../lib/cron-sweeps";

let passed = 0;
const ok = (fn: () => void) => {
  fn();
  passed++;
};
const now = Date.parse("2026-11-22T18:00:00Z");
const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
const built = siteCheckoutUrl("needs_payment", "https://www.kijiji.ca/p-post-ad.html?addToCart=true");

ok(() => assert.equal(built, KIJIJI_MY_ADS_URL));
ok(() => assert.equal(CHECKOUT_REMIND_AFTER_MS, 4 * 3600_000));
ok(() => assert.equal(checkoutReadyAction({ checkoutUrl: built, notifiedAt: null, remindedAt: null }, now), "notify"));
ok(() => assert.equal(checkoutReadyAction({ checkoutUrl: built, notifiedAt: ago(1), remindedAt: null }, now), "none"));
ok(() => assert.equal(checkoutReadyAction({ checkoutUrl: built, notifiedAt: ago(5), remindedAt: null }, now), "remind"));
ok(() => assert.equal(checkoutReadyAction({ checkoutUrl: built, notifiedAt: ago(9), remindedAt: ago(4) }, now), "none"));
// Not built (the bare post form) is not a checkout: no email.
const bare = siteCheckoutUrl("needs_payment", "https://www.kijiji.ca/p-post-ad.html");
ok(() => assert.equal(checkoutReadyAction({ checkoutUrl: bare, notifiedAt: null, remindedAt: null }, now), "none"));
// Paid and live (left needs_payment): stamps clear for the next turn.
const paid = siteCheckoutUrl("needs_operator", "https://www.kijiji.ca/p-post-ad.html?addToCart=true");
ok(() => assert.equal(checkoutReadyAction({ checkoutUrl: paid, notifiedAt: ago(2), remindedAt: null }, now), "clear"));

const mail = checkoutReadyEmail({ siteLabel: "Kijiji", where: "251 Manitoba St, Suite 124", priceCents: 3384, reminder: false });
ok(() => assert.equal(mail.subject, "Your Kijiji ad for 251 Manitoba St, Suite 124 is ready to pay"));
ok(() => assert.ok(mail.body.includes("Pay $33.84 and it goes up.")));
ok(() => assert.ok(mail.body.includes("Nothing is charged until you press Pay.")));
ok(() => assert.equal(mail.actionLabel, "Pay for the Kijiji ad"));
ok(() => assert.ok(!/—/.test(mail.subject + mail.body)));
const again = checkoutReadyEmail({ siteLabel: "Kijiji", where: "x", priceCents: null, reminder: true });
ok(() => assert.ok(again.subject.startsWith("Still waiting:") && again.body.includes("still waiting at checkout") && again.body.includes("Pay the fee")));

const route = readFileSync("app/api/cron/checkout-ready/route.ts", "utf8");
ok(() => assert.ok(route.includes("CRON_SECRET")));
ok(() => assert.ok(route.includes('get("dry") === "1"')));
ok(() => assert.ok(route.includes("claimNull(admin, \"distribution_run_items\"")));
ok(() => assert.ok(route.includes("921f7c08-98af-428f-a238-36f4a781b0de")));
ok(() => assert.ok((SWEEP_PATHS as readonly string[]).includes("/api/cron/checkout-ready")));
ok(() => assert.ok(readFileSync(".github/workflows/reminders.yml", "utf8").includes("/api/cron/checkout-ready")));
ok(() => assert.ok(readFileSync("supabase/migrations/0319_checkout_ready_email.sql", "utf8").includes("checkout_notified_at")));
ok(() => assert.ok(readFileSync("lib/message-catalog.ts", "utf8").includes('id: "you-checkout-ready"')));
ok(() => assert.ok(readFileSync("app/dashboard/properties/[id]/publish-everywhere.tsx", "utf8").includes("ready to pay about 5 minutes after you approve")));

console.log(`test-s829c-checkout-ready: ${passed} passed`);

// S829f: the ready-to-pay email is sent the moment an ad reaches checkout and
// names the site account to sign in to.
// Run: npx tsx scripts/test-s829f-checkout-instant.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkoutAccountLine, checkoutReadyEmail } from "../lib/checkout-ready";

let passed = 0;
const ok = (fn: () => void) => {
  fn();
  passed++;
};
ok(() =>
  assert.equal(
    checkoutAccountLine("Kijiji", "davis@example.com"),
    "Sign in to Kijiji as davis@example.com first. Another Kijiji account will not show this ad.",
  ),
);
ok(() =>
  assert.equal(
    checkoutAccountLine("Kijiji", "  "),
    "Sign in to Kijiji with the account you connected to Vacantless. Another Kijiji account will not show this ad.",
  ),
);
ok(() => assert.ok(checkoutAccountLine("Kijiji", null).startsWith("Sign in to Kijiji with the account")));
const mail = checkoutReadyEmail({ siteLabel: "Kijiji", where: "50 Glenrose Ave, Unit B", priceCents: 3384, reminder: false, accountLabel: "davis@example.com" });
ok(() => assert.ok(mail.body.includes("Sign in to Kijiji as davis@example.com first.")));
ok(() => assert.ok(checkoutReadyEmail({ siteLabel: "Kijiji", where: "x", priceCents: null, reminder: true }).body.includes("account you connected to Vacantless")));
// No sentence over 14 words, no em dash.
for (const s of checkoutAccountLine("Kijiji", null).split(/(?<=[.!?])\s+/)) ok(() => assert.ok(s.trim().split(/\s+/).length <= 14, s));
ok(() => assert.ok(!/—/.test(mail.body)));

const route = readFileSync("app/api/cron/checkout-ready/route.ts", "utf8");
ok(() => assert.ok(route.includes("sweep_trigger_secret_matches")));
ok(() => assert.ok(route.includes("distribution_channel_session_status") && route.includes("accountLabel,")));
const sql = readFileSync("supabase/migrations/0320_checkout_ready_instant.sql", "utf8");
ok(() => assert.ok(sql.includes("new.publish_status = 'needs_payment'") && sql.includes("new.checkout_notified_at is null")));
ok(() => assert.ok(sql.includes("/api/cron/checkout-ready") && sql.includes("exception when others")));
ok(() => assert.ok(sql.includes("revoke all on function public.notify_checkout_ready() from public, anon, authenticated")));
const ui = readFileSync("app/dashboard/properties/[id]/publish-everywhere.tsx", "utf8");
ok(() => assert.ok(ui.includes("{item.checkoutAccountLine}")));
console.log(`test-s829f-checkout-instant: ${passed} passed`);

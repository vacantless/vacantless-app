// S714d: a scheduled cancel shows on Billing ("Cancelled. You keep your plan until ...").
// Run: npx tsx scripts/test-billing-cancel.ts
import { readFileSync } from "node:fs";
import { buildBillingView, subscriptionCancelAtSeconds } from "../lib/billing";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`, extra ?? "");
  }
}

const periodEnd = 1794700800; // 2026-11-14T00:00:00Z
ok("cancel_at wins", subscriptionCancelAtSeconds({ cancel_at: 1794000000, cancel_at_period_end: true }, periodEnd) === 1794000000);
ok("cancel_at_period_end uses the period end", subscriptionCancelAtSeconds({ cancel_at: null, cancel_at_period_end: true }, periodEnd) === periodEnd);
ok("not cancelling is null", subscriptionCancelAtSeconds({ cancel_at: null, cancel_at_period_end: false }, periodEnd) === null);
ok("resumed (fields absent) is null", subscriptionCancelAtSeconds({}, periodEnd) === null);
ok("period-end cancel with no period end is null", subscriptionCancelAtSeconds({ cancel_at_period_end: true }, null) === null);

const base = {
  plan: "growth",
  subscription_status: "active",
  stripe_subscription_id: "sub_x",
  current_period_end: "2026-11-14T12:00:00Z",
  timezone: "America/Toronto",
};
const cancelling = buildBillingView({ ...base, subscription_cancel_at: "2026-11-14T12:00:00Z" });
ok("cancelling paid plan has a cancels-on label", cancelling.cancelsOnLabel === "November 14, 2026", cancelling.cancelsOnLabel);
ok("not cancelling has none", buildBillingView({ ...base, subscription_cancel_at: null }).cancelsOnLabel === null);
ok("free plan never shows a cancel line", buildBillingView({ ...base, plan: "free", subscription_cancel_at: "2026-11-14T12:00:00Z" }).cancelsOnLabel === null);

const page = readFileSync("app/dashboard/billing/page.tsx", "utf8");
ok("billing page passes the cancel date", page.includes("subscription_cancel_at: org.subscription_cancel_at"));
ok("billing page says cancelled before the active line", page.indexOf("view.cancelsOnLabel ?") > 0 && page.indexOf("view.cancelsOnLabel ?") < page.indexOf("current period ends"));
const hook = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
ok("webhook writes the cancel date every time", hook.includes("update.subscription_cancel_at ="));
ok("webhook clears it when the sub ends", /subscription_cancel_at: null/.test(hook));
const org = readFileSync("lib/org.ts", "utf8");
ok("current org reads the column", org.includes("subscription_cancel_at, pilot_started_at"));
const mig = readFileSync("supabase/migrations/0246_subscription_cancel_at.sql", "utf8");
ok("migration adds the column", /add column if not exists subscription_cancel_at timestamptz/.test(mig));

console.log(`\nbilling-cancel: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

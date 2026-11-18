// S816h: the bank authorization covers subscriptions and invoices.
// Run: npx tsx scripts/test-s816h-pad-mandate.ts
import { readFileSync } from "node:fs";
import { buildSetupSessionParams, mandateCoversSubscriptions } from "../lib/stripe-connect";
let failed = 0;
const ok = (n: string, c: boolean) => { if (!c) { failed++; console.error("FAIL:", n); } };
const ca = buildSetupSessionParams({ country: "CA", customerId: "cus_1", successUrl: "https://x/s", cancelUrl: "https://x/c" }) as {
  payment_method_options?: { acss_debit?: { mandate_options?: { default_for?: string[]; payment_schedule?: string } } };
};
const mo = ca.payment_method_options?.acss_debit?.mandate_options;
ok("default_for invoice + subscription", !!mo?.default_for?.includes("invoice") && !!mo?.default_for?.includes("subscription"));
ok("schedule kept", mo?.payment_schedule === "interval");
ok("old mandate refused", !mandateCoversSubscriptions({ payment_method_details: { type: "acss_debit", acss_debit: { default_for: [] } } }));
ok("old mandate no field refused", !mandateCoversSubscriptions({ payment_method_details: { type: "acss_debit", acss_debit: {} } }));
ok("new mandate ok", mandateCoversSubscriptions({ payment_method_details: { type: "acss_debit", acss_debit: { default_for: ["invoice", "subscription"] } } }));
ok("us bank ok", mandateCoversSubscriptions({ payment_method_details: { type: "us_bank_account" } }));
ok("no mandate ok", mandateCoversSubscriptions(null));
const act = readFileSync("app/dashboard/tenancies/stripe-rent-actions.ts", "utf8");
ok("checked before create", act.indexOf("mandateCoversSubscriptions(mandate)") > 0 && act.indexOf("mandateCoversSubscriptions(mandate)") < act.indexOf("stripe!.subscriptions.create("));
ok("page explains", readFileSync("app/dashboard/tenancies/[id]/page.tsx", "utf8").includes("reauthorize:"));
console.log(failed ? `${failed} failed` : "pad-mandate: all passed");
if (failed) process.exit(1);

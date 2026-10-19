// S724 (V251-16): Billing shows the next bill as Stripe will charge it. Run: npx tsx scripts/test-s724-next-bill.ts
import { readFileSync } from "node:fs";
import { nextBillLine } from "../lib/billing";
let p = 0, f = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) p++; else { f++; console.log("FAIL", n, JSON.stringify(g ?? "")); } }
const nov19 = Date.parse("2026-11-19T16:00:00Z") / 1000;
const free = nextBillLine({ amountDueCents: 0, subtotalCents: 14800, dateSec: nov19, discountNames: ["Internal test DMR posting"] });
ok("coupon covers it", free === "Next bill: $0 on Nov 19. Your discount (Internal test DMR posting) is applied.", free);
const full = nextBillLine({ amountDueCents: 14800, subtotalCents: 14800, dateSec: nov19, discountNames: [] });
ok("full price", full === "Next bill: $148 on Nov 19.", full);
ok("cents kept", nextBillLine({ amountDueCents: 9950, subtotalCents: 9950, dateSec: null, discountNames: [] }) === "Next bill: $99.50.");
ok("unnamed discount", /Your discount is applied\./.test(nextBillLine({ amountDueCents: 5000, subtotalCents: 14800, dateSec: null, discountNames: [] }) ?? ""));
ok("no preview, no line", nextBillLine(null) === null);
const page = readFileSync("app/dashboard/billing/page.tsx", "utf8");
ok("page reads Stripe's preview", /readNextBill\(org\.stripe_customer_id, org\.stripe_subscription_id\)/.test(page));
ok("page renders it", /\{nextBill\}/.test(page));
console.log(`s724-next-bill: ${p} passed, ${f} failed`);
if (f) process.exit(1);

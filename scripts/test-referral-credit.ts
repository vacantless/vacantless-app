// S746b: the referral credit decision (lib/referral-credit.ts) and the webhook wiring.
// Run: npx tsx scripts/test-referral-credit.ts
import { readFileSync } from "node:fs";
import {
  creditDescription,
  REFERRAL_CREDIT_CENTS,
  REFERRAL_CREDIT_COPY,
  referralCreditDecision,
  type ReferralInviteRow,
} from "../lib/referral-credit";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}`, extra ?? "");
  }
}

const REFEREE = "org-referee";
const REFERRER = "org-referrer";
const good: ReferralInviteRow = {
  id: "inv-1",
  status: "accepted",
  source: "referral",
  referred_by_org_id: REFERRER,
  provisioned_org_id: REFEREE,
  referral_credit_at: null,
};
const decide = (invite: ReferralInviteRow | null, amountPaidCents: number | null = 9900) =>
  referralCreditDecision({ amountPaidCents, refereeOrgId: REFEREE, invite });

ok("credit is one month of Growth", REFERRAL_CREDIT_CENTS === 9900);
const g = decide(good);
ok("accepted paid referral grants", g.grant && g.inviteId === "inv-1" && g.referrerOrgId === REFERRER, g);
ok("$0 invoice never grants", !decide(good, 0).grant);
ok("null amount never grants", !decide(good, null).grant);
ok("no invite row", !decide(null).grant && (decide(null) as { reason: string }).reason === "no_referral");
ok("operator invite is not a referral", !decide({ ...good, source: "operator" }).grant);
ok("pending referral not yet", !decide({ ...good, status: "pending" }).grant);
ok("wrong org", !decide({ ...good, provisioned_org_id: "other" }).grant);
ok("no referrer", !decide({ ...good, referred_by_org_id: null }).grant);
ok("self referral refused", !decide({ ...good, referred_by_org_id: REFEREE }).grant);
ok("already credited once only", (decide({ ...good, referral_credit_at: "2026-11-03T00:00:00Z" }) as { reason: string }).reason === "already_credited");

ok("referrer line names the friend", creditDescription("referrer", "Lakeview Rentals").includes("Lakeview Rentals"));
ok("referee line names the referrer", creditDescription("referee", "Agile").startsWith("Welcome credit"));
ok("blank names still read", creditDescription("referrer", "  ").length > 10 && creditDescription("referee", null).length > 10);
ok("copy carries the number once", REFERRAL_CREDIT_COPY.body.includes("$99") && !REFERRAL_CREDIT_COPY.body.includes("—"));

// wiring
const webhook = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
ok("webhook imports the grant", webhook.includes('from "@/lib/referral-credit-server"'));
const paidBranch = webhook.slice(webhook.indexOf('case "invoice.paid"'), webhook.indexOf('case "charge.refunded"'));
ok("grant runs on a paid invoice after the plan is applied", paidBranch.includes("grantReferralCredit(stripe, admin, applied.orgId, invoice)"));
const server = readFileSync("lib/referral-credit-server.ts", "utf8");
ok("claim before pay", server.indexOf('.is("referral_credit_at", null)') < server.indexOf("createBalanceTransaction"));
ok("credits are negative balance transactions", (server.match(/amount: -REFERRAL_CREDIT_CENTS/g) ?? []).length === 2);
const migration = readFileSync("supabase/migrations/0267_referral_credit.sql", "utf8");
ok("migration adds both columns", migration.includes("referral_credit_at") && migration.includes("referral_credit_cents"));
const page = readFileSync("app/dashboard/referrals/page.tsx", "utf8");
ok("referrals page says the offer", page.includes("REFERRAL_CREDIT_COPY.headline"));
ok("referrals page reads the stamp", page.includes("referral_credit_at"));

console.log(`test-referral-credit: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

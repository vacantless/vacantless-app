// Monthly spend cap for paid posting sites.
// Run: npx tsx scripts/test-spend-cap.ts
import { readFileSync } from "node:fs";
import {
  periodSpendCheck,
  periodStartUtc,
  nextChargeCentsFor,
  spendCapBlockMessage,
} from "../lib/spend-cap";

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

// --- pure check ---
ok(
  "no limits passes",
  periodSpendCheck({ spentThisPeriodCents: 999999, nextChargeCents: 3384, periodMaxCents: null, perAdMaxCents: null }).ok,
);
ok(
  "first ad inside monthly limit passes",
  periodSpendCheck({ spentThisPeriodCents: 0, nextChargeCents: 3384, periodMaxCents: 3384, perAdMaxCents: 3384 }).ok,
);
const over = periodSpendCheck({ spentThisPeriodCents: 3384, nextChargeCents: 3384, periodMaxCents: 3384, perAdMaxCents: 3384 });
ok("second ad over monthly limit blocks", !over.ok && over.reason === "spend_period_cap");
ok(
  "exactly at the limit passes",
  periodSpendCheck({ spentThisPeriodCents: 3384, nextChargeCents: 3384, periodMaxCents: 6768, perAdMaxCents: null }).ok,
);
const perAd = periodSpendCheck({ spentThisPeriodCents: 0, nextChargeCents: 3384, periodMaxCents: null, perAdMaxCents: 2995 });
ok("per-ad limit below the fee blocks", !perAd.ok && perAd.reason === "spend_per_ad_cap");
ok(
  "zero monthly limit means no limit",
  periodSpendCheck({ spentThisPeriodCents: 50000, nextChargeCents: 3384, periodMaxCents: 0, perAdMaxCents: null }).ok,
);
ok(
  "free post never blocks",
  periodSpendCheck({ spentThisPeriodCents: 9999, nextChargeCents: 0, periodMaxCents: 100, perAdMaxCents: 100 }).ok,
);

// --- fee and period ---
ok("kijiji fee is the list price", nextChargeCentsFor("kijiji", 9999) === 3384);
ok("unknown paid site falls back to the per-ad limit", nextChargeCentsFor("made_up_site", 1500) === 1500);
ok(
  "October starts at 04:00 UTC (EDT)",
  periodStartUtc(new Date("2026-10-13T15:00:00Z")).toISOString() === "2026-10-01T04:00:00.000Z",
);
ok(
  "January starts at 05:00 UTC (EST)",
  periodStartUtc(new Date("2026-01-20T12:00:00Z")).toISOString() === "2026-01-01T05:00:00.000Z",
);
ok(
  "late on Oct 31 Toronto time is still October",
  periodStartUtc(new Date("2026-11-01T02:30:00Z")).toISOString() === "2026-10-01T04:00:00.000Z",
);

// --- copy ---
const msg = spendCapBlockMessage({ reason: "spend_period_cap", channel: "kijiji", periodMaxCents: 3384 });
ok("message shows dollars", msg.includes("$33.84"));
ok("message never shows raw cents", !msg.includes("3384"));
ok("message names the site", msg.includes("Kijiji"));
ok("message points to Settings", msg.includes("Settings"));
ok("no em dashes in message", !msg.includes(String.fromCharCode(0x2014)));
const perAdMsg = spendCapBlockMessage({ reason: "spend_per_ad_cap", channel: "kijiji", perAdMaxCents: 2995 });
ok("per-ad message shows dollars", perAdMsg.includes("$29.95"));

// --- wiring ---
const cron = readFileSync("app/api/cron/distribution-worker/route.ts", "utf8");
const userPath = readFileSync("app/dashboard/properties/distribution-actions.ts", "utf8");
const desk = readFileSync("app/dashboard/admin/concierge-actions.ts", "utf8");
const lib = readFileSync("lib/spend-cap.ts", "utf8");
const settings = readFileSync("app/dashboard/settings/page.tsx", "utf8");

ok("cron calls checkPeriodSpend", cron.includes("checkPeriodSpend(admin"));
ok("cron reads spend_period_max_cents", cron.includes("spend_period_max_cents"));
ok("cron withholds payment clearance on a block", cron.includes("spendCapBlock == null"));
ok("cron records the error code on the item", cron.includes("error_code: spendCapBlock.code"));
ok("user approve calls checkPeriodSpend", userPath.includes("checkPeriodSpend(supabase"));
ok("user approve redirects with a spend cap flag", userPath.includes('"autopilot_spend_cap"'));
ok(
  "user check runs before the approval write",
  userPath.indexOf("checkPeriodSpend(supabase") < userPath.indexOf("operator_submit_approved_at: now"),
);
ok("desk approve calls checkPeriodSpend", desk.includes("checkPeriodSpend(admin"));
ok(
  "desk check runs before the approval write",
  desk.indexOf("checkPeriodSpend(admin") < desk.indexOf("operator_submit_approved_at: now"),
);
ok("sums the real charge ledger", lib.includes('.from("distribution_channel_spend")'));
ok("falls back to posted run items", lib.includes('.from("distribution_run_items")'));
ok("settings explains the month", settings.includes("Resets on the 1st of each month, Toronto time."));

console.log(`\ntest-spend-cap: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// S748c: each Stripe event is processed once; a failed run can be retried.
// Run: npx tsx scripts/test-s748-stripe-event-claim.ts
import { readFileSync, existsSync } from "node:fs";
import { CLAIM_TABLE, claimStripeEvent, releaseStripeEvent } from "../lib/stripe-event-claim";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
    if (extra !== undefined) console.error("    ->", JSON.stringify(extra));
  }
}

function fakeDb(opts: { throwOnInsert?: boolean; otherError?: boolean } = {}) {
  const ids = new Set<string>();
  const tables: string[] = [];
  return {
    ids,
    tables,
    from(table: string) {
      tables.push(table);
      return {
        insert: async (row: Record<string, unknown>) => {
          if (opts.throwOnInsert) throw new Error("network");
          if (opts.otherError) return { error: { code: "42P01", message: "relation does not exist" } };
          const id = String(row.event_id);
          if (ids.has(id)) return { error: { code: "23505", message: "duplicate key" } };
          ids.add(id);
          return { error: null };
        },
        delete: () => ({
          eq: async (_c: string, v: unknown) => {
            ids.delete(String(v));
          },
          lt: async () => undefined,
        }),
      };
    },
  };
}

(async () => {
  const db = fakeDb();
  ok("first delivery is new", (await claimStripeEvent(db, "evt_1", "invoice.paid")) === "new");
  ok("second delivery is a duplicate", (await claimStripeEvent(db, "evt_1", "invoice.paid")) === "duplicate");
  ok("another event is new", (await claimStripeEvent(db, "evt_2")) === "new");
  ok("writes the claim table", db.tables.every((t) => t === CLAIM_TABLE) && CLAIM_TABLE === "stripe_webhook_events");
  await releaseStripeEvent(db, "evt_1");
  ok("released event can be taken again", (await claimStripeEvent(db, "evt_1")) === "new");
  ok("missing table fails open", (await claimStripeEvent(fakeDb({ otherError: true }), "evt_x")) === "unknown");
  ok("network error fails open", (await claimStripeEvent(fakeDb({ throwOnInsert: true }), "evt_x")) === "unknown");
  ok("no client fails open", (await claimStripeEvent(null, "evt_x")) === "unknown");
  ok("no id fails open", (await claimStripeEvent(db, "")) === "unknown");
  let threw = false;
  try {
    await releaseStripeEvent({ from: () => { throw new Error("x"); } }, "evt_1");
  } catch {
    threw = true;
  }
  ok("release never throws", !threw);

  const route = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
  const claimAt = route.indexOf("claimStripeEvent(admin, event.id");
  ok("route claims after verifying the signature", claimAt > route.indexOf("constructEvent(") && claimAt > 0);
  ok("route claims before the rent path", claimAt < route.indexOf("if (event.account)"));
  ok("duplicate is acknowledged with 200", /claim === "duplicate"[\s\S]{0,200}duplicate: true[\s\S]{0,40}status: 200/.test(route));
  ok("failed run releases its claim", /catch \(err\)[\s\S]{0,200}releaseStripeEvent\(admin, event\.id\)/.test(route));
  ok("migration 0270 exists", existsSync("supabase/migrations/0270_stripe_webhook_events.sql"));
  ok("webhook suite stubs the claim", /@\/lib\/stripe-event-claim/.test(readFileSync("scripts/test-stripe-webhook.ts", "utf8")));

  console.log(`\ns748 stripe event claim: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();

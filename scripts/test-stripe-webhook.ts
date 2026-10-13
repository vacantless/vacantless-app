// Unit tests for the Stripe webhook route. Run: npx tsx scripts/test-stripe-webhook.ts
import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";
import ts from "typescript";
import * as billing from "../lib/billing";
import {
  isRentReconcileEvent,
  rentStatusFromEvent,
  shouldApplyRentStatus,
  subscriptionIdOfInvoice,
} from "../lib/stripe-connect";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  \u2717 ${name}`);
  }
}

type OrgRow = {
  id: string;
  plan?: string | null;
  subscription_status?: string | null;
  stripe_subscription_id?: string | null;
  stripe_customer_id?: string | null;
  current_period_end?: string | null;
  [key: string]: unknown;
};

type FakeDb = {
  organizations: Map<string, OrgRow>;
  updates: Array<{
    table: string;
    values: Record<string, unknown>;
    column: string;
    value: unknown;
  }>;
};

class FakeQuery {
  private selected: string | null = null;
  private updateValues: Record<string, unknown> | null = null;
  private filters: Array<{ column: string; value: unknown }> = [];

  constructor(
    private readonly table: string,
    private readonly db: FakeDb,
  ) {}

  select(columns: string) {
    this.selected = columns;
    return this;
  }

  update(values: Record<string, unknown>) {
    this.updateValues = values;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
    if (!this.updateValues) return this;

    const rows = this.matchRows();
    rows.forEach((row) => Object.assign(row, this.updateValues));
    this.db.updates.push({
      table: this.table,
      values: { ...this.updateValues },
      column,
      value,
    });
    return Promise.resolve({ data: rows, error: null });
  }

  maybeSingle() {
    const row = this.matchRows()[0];
    return Promise.resolve({ data: row ? this.project(row) : null, error: null });
  }

  limit(n: number) {
    return Promise.resolve({
      data: this.matchRows()
        .slice(0, n)
        .map((row) => this.project(row)),
      error: null,
    });
  }

  private matchRows(): OrgRow[] {
    if (this.table !== "organizations") return [];
    let rows = Array.from(this.db.organizations.values());
    for (const filter of this.filters) {
      rows = rows.filter((row) => row[filter.column] === filter.value);
    }
    return rows;
  }

  private project(row: OrgRow): Record<string, unknown> {
    if (!this.selected || this.selected === "*") return { ...row };
    return this.selected.split(",").reduce<Record<string, unknown>>((out, column) => {
      const key = column.trim();
      out[key] = row[key];
      return out;
    }, {});
  }
}

function createFakeAdmin(initialOrgs: OrgRow[]) {
  const db: FakeDb = {
    organizations: new Map(initialOrgs.map((org) => [org.id, { ...org }])),
    updates: [],
  };
  return {
    db,
    admin: {
      from(table: string) {
        return new FakeQuery(table, db);
      },
    },
  };
}

type FakeEvent = {
  type: string;
  account?: string;
  data: { object: unknown };
};

function activeSubscription(
  id: string,
  orgId: string,
  priceId: string,
  status = "active",
) {
  return {
    id,
    status,
    customer: "cus_123",
    metadata: { org_id: orgId },
    items: {
      data: [
        {
          price: { id: priceId },
          current_period_end: 1784137920,
        },
      ],
    },
  };
}

function createStripe(event: FakeEvent, subscriptions: Record<string, unknown>) {
  const retrieved: string[] = [];
  return {
    retrieved,
    stripe: {
      webhooks: {
        constructEvent() {
          return event;
        },
      },
      subscriptions: {
        async retrieve(subId: string) {
          retrieved.push(subId);
          const sub = subscriptions[subId];
          if (!sub) throw new Error(`missing test subscription ${subId}`);
          return sub;
        },
      },
    },
  };
}

type RouteExports = {
  POST: (req: {
    text: () => Promise<string>;
    headers: { get: (name: string) => string | null };
  }) => Promise<Response>;
};

function loadRoute(event: FakeEvent, admin: unknown, subscriptions: Record<string, unknown>) {
  const { stripe, retrieved } = createStripe(event, subscriptions);
  const source = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: "app/api/stripe/webhook/route.ts",
  }).outputText;

  const exportsObj: Record<string, unknown> = {};
  const moduleObj = { exports: exportsObj };
  const sandbox = createContext({
    Buffer,
    Response,
    clearTimeout,
    console,
    exports: exportsObj,
    module: moduleObj,
    process,
    require(id: string) {
      if (id === "next/server") {
        return {
          NextResponse: {
            json(data: unknown, init?: ResponseInit) {
              return new Response(JSON.stringify(data), {
                status: init?.status ?? 200,
                headers: { "content-type": "application/json" },
              });
            },
          },
        };
      }
      if (id === "@/lib/stripe") {
        return {
          getStripe: () => stripe,
          priceMap: () => ({ price_growth: "growth", price_premium: "premium" }),
          postingAddonPriceId: () => process.env.STRIPE_PRICE_POSTING_ADDON || null,
        };
      }
      if (id === "@/lib/supabase/admin") {
        return { createAdminClient: () => admin };
      }
      if (id === "@/lib/billing") {
        return billing;
      }
      if (id === "@/lib/stripe-connect") {
        return {
          isRentReconcileEvent,
          rentStatusFromEvent,
          shouldApplyRentStatus,
          subscriptionIdOfInvoice,
        };
      }
      throw new Error(`Unexpected require: ${id}`);
    },
    setTimeout,
  });
  new Script(compiled, { filename: "app/api/stripe/webhook/route.ts" }).runInContext(sandbox);
  return { route: moduleObj.exports as RouteExports, retrieved };
}

async function postEvent(
  event: FakeEvent,
  admin: unknown,
  subscriptions: Record<string, unknown> = {},
) {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  const { route, retrieved } = loadRoute(event, admin, subscriptions);
  const response = await route.POST({
    text: async () => JSON.stringify(event),
    headers: { get: (name: string) => (name.toLowerCase() === "stripe-signature" ? "sig" : null) },
  });
  const body = (await response.json()) as { ok?: boolean; type?: string };
  return { body, response, retrieved };
}

async function run() {
  {
    const { admin, db } = createFakeAdmin([
      {
        id: "org_growth",
        plan: "free",
        subscription_status: "incomplete",
        stripe_subscription_id: "sub_growth",
      },
    ]);
    const { body, response, retrieved } = await postEvent(
      {
        type: "invoice.paid",
        data: { object: { id: "in_growth", subscription: "sub_growth" } },
      },
      admin,
      {
        sub_growth: activeSubscription("sub_growth", "org_growth", "price_growth"),
      },
    );
    const org = db.organizations.get("org_growth");
    ok(
      "invoice.paid retrieves the subscription and promotes incomplete Growth org to active",
      response.status === 200 &&
        body.ok === true &&
        retrieved.join(",") === "sub_growth" &&
        org?.subscription_status === "active" &&
        org?.plan === "growth",
    );
  }

  {
    const { admin, db } = createFakeAdmin([
      {
        id: "org_premium",
        plan: "free",
        subscription_status: "incomplete",
        stripe_subscription_id: "sub_premium",
      },
    ]);
    const { retrieved } = await postEvent(
      {
        type: "invoice.payment_succeeded",
        data: {
          object: {
            id: "in_premium",
            parent: { subscription_details: { subscription: "sub_premium" } },
          },
        },
      },
      admin,
      {
        sub_premium: activeSubscription("sub_premium", "org_premium", "price_premium"),
      },
    );
    const org = db.organizations.get("org_premium");
    ok(
      "invoice.payment_succeeded uses the parent subscription shape and promotes Premium org",
      retrieved.join(",") === "sub_premium" &&
        org?.subscription_status === "active" &&
        org?.plan === "premium",
    );
  }

  {
    const { admin, db } = createFakeAdmin([
      {
        id: "org_deposit",
        plan: "pilot",
        subscription_status: null,
        stripe_subscription_id: null,
      },
    ]);
    const { body, response, retrieved } = await postEvent(
      {
        type: "invoice.paid",
        data: { object: { id: "in_one_time" } },
      },
      admin,
    );
    const org = db.organizations.get("org_deposit");
    ok(
      "invoice.paid with no subscription is a no-op for one-time/deposit-style invoices",
      response.status === 200 &&
        body.ok === true &&
        retrieved.length === 0 &&
        db.updates.length === 0 &&
        org?.plan === "pilot",
    );
  }

  {
    const { admin, db } = createFakeAdmin([
      {
        id: "org_active",
        plan: "growth",
        subscription_status: "active",
        stripe_subscription_id: "sub_active",
      },
    ]);
    await postEvent(
      {
        type: "customer.subscription.updated",
        data: {
          object: activeSubscription("sub_active", "org_active", "price_growth", "incomplete"),
        },
      },
      admin,
    );
    const org = db.organizations.get("org_active");
    ok(
      "stale incomplete subscription event still does not downgrade an active org",
      org?.subscription_status === "active",
    );
  }
}

async function runS712() {
  // S712: an incomplete first payment must NOT grant Growth.
  {
    const { admin, db } = createFakeAdmin([
      { id: "org_inc", plan: "free", subscription_status: null, stripe_subscription_id: null, sms_enabled: false },
    ]);
    await postEvent(
      {
        type: "customer.subscription.created",
        data: { object: activeSubscription("sub_inc", "org_inc", "price_growth", "incomplete") },
      },
      admin,
    );
    const org = db.organizations.get("org_inc");
    ok(
      "S712: incomplete new subscription leaves a free org on free with texts off",
      org?.plan === "free" && org?.subscription_status === "incomplete" && org?.sms_enabled === false,
    );
  }
  // S712: subscription.updated active -> Growth AND texts on (not only checkout).
  {
    const { admin, db } = createFakeAdmin([
      { id: "org_up", plan: "free", subscription_status: "incomplete", stripe_subscription_id: "sub_up", sms_enabled: false },
    ]);
    await postEvent(
      {
        type: "customer.subscription.updated",
        data: { object: activeSubscription("sub_up", "org_up", "price_growth", "active") },
      },
      admin,
    );
    const org = db.organizations.get("org_up");
    ok("S712: subscription.updated active grants Growth", org?.plan === "growth");
    ok("S712: moving onto Growth switches texts on", org?.sms_enabled === true);
  }
  // S712: a renewal on Growth never re-enables texts the owner turned off.
  {
    const { admin, db } = createFakeAdmin([
      { id: "org_ren", plan: "growth", subscription_status: "active", stripe_subscription_id: "sub_ren", sms_enabled: false },
    ]);
    await postEvent(
      {
        type: "customer.subscription.updated",
        data: { object: activeSubscription("sub_ren", "org_ren", "price_growth", "active") },
      },
      admin,
    );
    const org = db.organizations.get("org_ren");
    ok("S712: Growth renewal keeps texts off when the owner turned them off", org?.sms_enabled === false && org?.plan === "growth");
  }
  // S712: unpaid drops a paying org to free.
  {
    const { admin, db } = createFakeAdmin([
      { id: "org_unpaid", plan: "growth", subscription_status: "past_due", stripe_subscription_id: "sub_unpaid" },
    ]);
    await postEvent(
      {
        type: "customer.subscription.updated",
        data: { object: activeSubscription("sub_unpaid", "org_unpaid", "price_growth", "unpaid") },
      },
      admin,
    );
    const org = db.organizations.get("org_unpaid");
    ok("S712: unpaid subscription moves a Growth org to free", org?.plan === "free" && org?.subscription_status === "unpaid");
  }
  // S712: past_due keeps Growth (grace window).
  {
    const { admin, db } = createFakeAdmin([
      { id: "org_pd", plan: "growth", subscription_status: "active", stripe_subscription_id: "sub_pd" },
    ]);
    await postEvent(
      {
        type: "customer.subscription.updated",
        data: { object: activeSubscription("sub_pd", "org_pd", "price_growth", "past_due") },
      },
      admin,
    );
    const org = db.organizations.get("org_pd");
    ok("S712: past_due keeps Growth", org?.plan === "growth" && org?.subscription_status === "past_due");
  }
}

// S713: the Posting add-on rides on the Growth subscription as a 2nd item.
function subWithItems(
  id: string,
  orgId: string,
  items: Array<{ id: string; price: string }>,
  status = "active",
) {
  return {
    id,
    status,
    customer: "cus_123",
    metadata: { org_id: orgId },
    items: {
      data: items.map((it) => ({ id: it.id, price: { id: it.price }, current_period_end: 1784137920 })),
    },
  };
}

async function runS713() {
  process.env.STRIPE_PRICE_POSTING_ADDON = "price_addon";
  // Checkout with Growth + Posting, add-on item listed FIRST.
  {
    const { admin, db } = createFakeAdmin([
      { id: "org_both", plan: "free", subscription_status: null, stripe_subscription_id: null, posting_addon_active: false, posting_addon_subscription_item_id: null },
    ]);
    await postEvent(
      {
        type: "customer.subscription.created",
        data: {
          object: subWithItems("sub_both", "org_both", [
            { id: "si_addon", price: "price_addon" },
            { id: "si_growth", price: "price_growth" },
          ]),
        },
      },
      admin,
    );
    const org = db.organizations.get("org_both");
    ok("S713: Growth is found even when the add-on item is first", org?.plan === "growth");
    ok(
      "S713: active sub with the add-on item turns Posting on and stores the item",
      org?.posting_addon_active === true && org?.posting_addon_subscription_item_id === "si_addon",
    );
  }
  // Item removed -> off.
  {
    const { admin, db } = createFakeAdmin([
      { id: "org_rm", plan: "growth", subscription_status: "active", stripe_subscription_id: "sub_rm", posting_addon_active: true, posting_addon_subscription_item_id: "si_addon" },
    ]);
    await postEvent(
      {
        type: "customer.subscription.updated",
        data: { object: subWithItems("sub_rm", "org_rm", [{ id: "si_growth", price: "price_growth" }]) },
      },
      admin,
    );
    const org = db.organizations.get("org_rm");
    ok(
      "S713: removing the add-on item turns Posting off, Growth stays",
      org?.posting_addon_active === false && org?.posting_addon_subscription_item_id === null && org?.plan === "growth",
    );
  }
  // Grandfathered (Agile): flag on, no item. A plain Growth renewal leaves it on.
  {
    const { admin, db } = createFakeAdmin([
      { id: "org_gf", plan: "growth", subscription_status: "active", stripe_subscription_id: "sub_gf", posting_addon_active: true, posting_addon_subscription_item_id: null },
    ]);
    await postEvent(
      {
        type: "invoice.paid",
        data: { object: { id: "in_gf", subscription: "sub_gf" } },
      },
      admin,
      { sub_gf: subWithItems("sub_gf", "org_gf", [{ id: "si_growth", price: "price_growth" }]) },
    );
    const org = db.organizations.get("org_gf");
    ok("S713: grandfathered Posting survives a Growth renewal", org?.posting_addon_active === true && org?.plan === "growth");
  }
  // Deleted sub with a bought add-on -> off.
  {
    const { admin, db } = createFakeAdmin([
      { id: "org_del", plan: "growth", subscription_status: "active", stripe_subscription_id: "sub_del", posting_addon_active: true, posting_addon_subscription_item_id: "si_addon" },
    ]);
    await postEvent(
      {
        type: "customer.subscription.deleted",
        data: {
          object: subWithItems("sub_del", "org_del", [
            { id: "si_growth", price: "price_growth" },
            { id: "si_addon", price: "price_addon" },
          ], "canceled"),
        },
      },
      admin,
    );
    const org = db.organizations.get("org_del");
    ok("S713: deleted subscription turns a bought add-on off", org?.posting_addon_active === false && org?.plan === "free");
  }
  // Price env unset -> the add-on columns are never touched.
  {
    delete process.env.STRIPE_PRICE_POSTING_ADDON;
    const { admin, db } = createFakeAdmin([
      { id: "org_noenv", plan: "growth", subscription_status: "active", stripe_subscription_id: "sub_noenv", posting_addon_active: true, posting_addon_subscription_item_id: "si_addon" },
    ]);
    await postEvent(
      {
        type: "customer.subscription.updated",
        data: { object: subWithItems("sub_noenv", "org_noenv", [{ id: "si_growth", price: "price_growth" }]) },
      },
      admin,
    );
    const org = db.organizations.get("org_noenv");
    ok(
      "S713: no add-on price set leaves the add-on columns alone",
      org?.posting_addon_active === true && !db.updates.some((u) => "posting_addon_active" in u.values),
    );
  }
}

run().then(runS712).then(runS713).then(() => {
  console.log(`\nstripe-webhook: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});

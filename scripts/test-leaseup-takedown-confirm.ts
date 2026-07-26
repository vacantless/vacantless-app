// Unit tests for S577b operator lease-up take-down confirmation.
// Run: npx tsx scripts/test-leaseup-takedown-confirm.ts
import { confirmLeaseupTakedownRemoved } from "../lib/leaseup-takedown-confirm";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
    if (extra !== undefined) console.error("    ->", JSON.stringify(extra));
  }
}

const ORG_ID = "org_1";
const OTHER_ORG_ID = "org_2";
const USER_ID = "user_1";

type Row = Record<string, unknown>;
type Filter = { column: string; value: unknown };

class FakeSupabase {
  runItems: Row[] = [];
  runs: Row[] = [];
  listingPosts: Row[] = [];
  verifications: Row[] = [];
  private verificationSeq = 1;

  auth = {
    getUser: async () => ({ data: { user: { id: USER_ID } } }),
  };

  from(table: string) {
    return new FakeQuery(this, table);
  }

  nextVerificationId() {
    return `ver_${this.verificationSeq++}`;
  }
}

class FakeQuery {
  private op: "select" | "insert" | "update" = "select";
  private filters: Filter[] = [];
  private payload: Row | null = null;
  private limitCount: number | null = null;

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select() {
    return this;
  }

  insert(payload: Row) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, value });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  maybeSingle() {
    return this.exec(true);
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.exec(false).then(onfulfilled, onrejected);
  }

  private async exec(single: boolean) {
    if (this.op === "insert") return this.execInsert(single);
    if (this.op === "update") return this.execUpdate(single);
    const rows = this.applyFilters(this.rowsForTable());
    const limited = this.limitCount == null ? rows : rows.slice(0, this.limitCount);
    return { data: single ? limited[0] ?? null : limited, error: null };
  }

  private execInsert(single: boolean) {
    if (!this.payload) return { data: single ? null : [], error: null };
    if (this.table === "distribution_verifications") {
      const row = { id: this.db.nextVerificationId(), ...this.payload };
      this.db.verifications.push(row);
      return { data: single ? row : [row], error: null };
    }
    return { data: single ? null : [], error: null };
  }

  private execUpdate(single: boolean) {
    if (!this.payload) return { data: single ? null : [], error: null };
    const rows = this.applyFilters(this.rowsForTable());
    for (const row of rows) Object.assign(row, this.payload);
    const selected = rows.map((row) => ({ id: row.id }));
    return { data: single ? selected[0] ?? null : selected, error: null };
  }

  private rowsForTable(): Row[] {
    if (this.table === "distribution_run_items") return this.db.runItems;
    if (this.table === "distribution_runs") return this.db.runs;
    if (this.table === "listing_posts") return this.db.listingPosts;
    if (this.table === "distribution_verifications") return this.db.verifications;
    return [];
  }

  private applyFilters(rows: Row[]): Row[] {
    return rows.filter((row) =>
      this.filters.every((filter) => row[filter.column] === filter.value),
    );
  }
}

function seededDb(): FakeSupabase {
  const db = new FakeSupabase();
  db.runs.push({
    id: "run_1",
    organization_id: ORG_ID,
    property_id: "property_1",
    status: "active",
  });
  db.runItems.push({
    id: "item_1",
    organization_id: ORG_ID,
    run_id: "run_1",
    channel: "kijiji",
    transport: "takedown",
    publish_status: "needs_operator",
    status: "in_progress",
    external_url: "https://www.kijiji.ca/v-test",
    operator_action_url: "https://www.kijiji.ca/v-test",
    listing_post_id: "post_1",
    concierge_claimed_by: "agent_1",
  });
  db.listingPosts.push({
    id: "post_1",
    organization_id: ORG_ID,
    property_id: "property_1",
    portal: "kijiji",
    status: "live",
    url: "https://www.kijiji.ca/v-test",
  });
  return db;
}

async function run() {
  const oldFlag = process.env.LEASEUP_TAKEDOWN_ENABLED;
  process.env.LEASEUP_TAKEDOWN_ENABLED = "true";
  try {
    const db = seededDb();
    const first = await confirmLeaseupTakedownRemoved({
      supabase: db as never,
      org: { id: ORG_ID },
      runItemId: "item_1",
    });
    ok("first confirm succeeds", first.ok, first);
    ok("writes exactly one removed verification", db.verifications.length === 1);
    ok("verification result is removed", db.verifications[0]?.result === "removed");
    ok(
      "verification metadata records operator source",
      (db.verifications[0]?.metadata as Row | undefined)?.source ===
        "operator_takedown_confirm",
    );
    ok("listing_post flips to removed", db.listingPosts[0]?.status === "removed");
    ok("item leaves needs_operator", db.runItems[0]?.publish_status === "skipped");
    ok("item is done", db.runItems[0]?.status === "done");
    ok("item clears concierge claim", db.runItems[0]?.concierge_claimed_by === null);
    ok("item points at verification", db.runItems[0]?.last_verification_id === "ver_1");

    const second = await confirmLeaseupTakedownRemoved({
      supabase: db as never,
      org: { id: ORG_ID },
      runItemId: "item_1",
    });
    ok("second confirm is idempotent", second.ok && second.idempotent === true, second);
    ok("second confirm writes no duplicate verification", db.verifications.length === 1);

    const nonTakedown = seededDb();
    nonTakedown.runItems[0] = {
      ...nonTakedown.runItems[0],
      id: "item_2",
      transport: "browser_copilot",
      listing_post_id: "post_1",
    };
    const refusedKind = await confirmLeaseupTakedownRemoved({
      supabase: nonTakedown as never,
      org: { id: ORG_ID },
      runItemId: "item_2",
    });
    ok("refuses non-takedown item", !refusedKind.ok && refusedKind.reason === "not_takedown", refusedKind);
    ok("non-takedown writes no verification", nonTakedown.verifications.length === 0);

    const otherOrg = seededDb();
    const refusedOrg = await confirmLeaseupTakedownRemoved({
      supabase: otherOrg as never,
      org: { id: OTHER_ORG_ID },
      runItemId: "item_1",
    });
    ok("refuses another org's item", !refusedOrg.ok && refusedOrg.reason === "not_found", refusedOrg);
    ok("wrong-org confirm writes no verification", otherOrg.verifications.length === 0);
  } finally {
    if (oldFlag == null) delete process.env.LEASEUP_TAKEDOWN_ENABLED;
    else process.env.LEASEUP_TAKEDOWN_ENABLED = oldFlag;
  }
}

run()
  .then(() => {
    console.log(`leaseup-takedown-confirm: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    failed++;
    console.error(err);
    console.log(`leaseup-takedown-confirm: ${passed} passed, ${failed} failed`);
    process.exit(1);
  });

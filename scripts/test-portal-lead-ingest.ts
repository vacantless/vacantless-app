// Unit tests for portal lead route idempotency (S577).
// Run: npx tsx scripts/test-portal-lead-ingest.ts
import { readFileSync } from "node:fs";
import {
  handleInboundLeadPost,
  isMissingIngestMessageKeyColumnError,
  portalLeadMessageKey,
} from "../lib/portal-lead-ingest-server";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
    if (extra !== undefined) console.error("    ->", JSON.stringify(extra));
  }
}

const SECRET = "test-secret";
const ORG_ID = "8ea1da48-0000-0000-0000-000000000001";
const TOKEN = "abcdefghijklmnopqrstuvwx";
const FROM = "forwarder@example.com";
const NOW = Date.parse("2026-07-26T16:00:00.000Z");

type LeadRow = {
  id: string;
  organization_id: string;
  property_id: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  source_detail: string | null;
  listing_post_id: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  ingest_message_key?: string | null;
};

type Filter = { type: "eq" | "neq" | "gte" | "ilike" | "not" | "is"; column: string; value: unknown };

class FakeAdmin {
  leads: LeadRow[] = [];
  notifications = 0;
  missingIngestMessageKeyColumn = false;
  keyLookupMissesRemaining = 0;
  private leadSeq = 1;

  from(table: string) {
    return new FakeQuery(this, table);
  }

  async rpc() {
    return { data: null, error: { message: "Listing not available" } };
  }

  nextLeadId() {
    return `lead_${this.leadSeq++}`;
  }
}

class FakeQuery {
  private op: "select" | "insert" | "update" = "select";
  private filters: Filter[] = [];
  private payload: Record<string, unknown> | null = null;
  private limitCount: number | null = null;

  constructor(private readonly admin: FakeAdmin, private readonly table: string) {}

  select() {
    return this;
  }

  insert(payload: Record<string, unknown>) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.op = "update";
    this.payload = payload;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ type: "neq", column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ type: "gte", column, value });
    return this;
  }

  ilike(column: string, value: unknown) {
    this.filters.push({ type: "ilike", column, value });
    return this;
  }

  not(column: string, op: string, value: unknown) {
    this.filters.push({ type: "not", column, value: { op, value } });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ type: "is", column, value });
    return this;
  }

  order() {
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
    if (this.referencesIngestMessageKey() && this.admin.missingIngestMessageKeyColumn) {
      return {
        data: single ? null : [],
        error: {
          code: "42703",
          message: 'column "ingest_message_key" of relation "leads" does not exist',
        },
      };
    }

    if (this.op === "insert") return this.execInsert();
    if (this.op === "update") return this.execUpdate(single);

    const rows = this.applyFilters(this.rowsForTable());
    const limited = this.limitCount == null ? rows : rows.slice(0, this.limitCount);
    if (this.table === "leads" && this.hasFilter("ingest_message_key") && this.admin.keyLookupMissesRemaining > 0) {
      this.admin.keyLookupMissesRemaining--;
      return { data: single ? null : [], error: null };
    }
    return { data: single ? limited[0] ?? null : limited, error: null };
  }

  private execInsert() {
    if (this.table !== "leads" || !this.payload) return { data: null, error: null };
    const key = this.payload.ingest_message_key;
    if (
      typeof key === "string" &&
      this.admin.leads.some((row) => row.organization_id === this.payload?.organization_id && row.ingest_message_key === key)
    ) {
      return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    }
    const row = {
      id: this.admin.nextLeadId(),
      created_at: new Date(NOW).toISOString(),
      ...this.payload,
    } as LeadRow;
    this.admin.leads.push(row);
    return { data: { id: row.id }, error: null };
  }

  private execUpdate(single: boolean) {
    if (this.table !== "leads" || !this.payload) return { data: single ? null : [], error: null };
    const rows = this.applyFilters(this.admin.leads);
    for (const row of rows) {
      Object.assign(row, this.payload);
    }
    return { data: single ? rows[0] ?? null : rows, error: null };
  }

  private rowsForTable(): Record<string, unknown>[] {
    if (this.table === "org_ingest_addresses") {
      return [{ organization_id: ORG_ID, token: TOKEN, active: true }];
    }
    if (this.table === "org_ingest_senders") {
      return [{ organization_id: ORG_ID, channel: "email", verified_at: new Date(NOW).toISOString(), address: FROM }];
    }
    if (this.table === "properties") return [];
    if (this.table === "listing_posts") return [];
    if (this.table === "leads") return this.admin.leads;
    return [];
  }

  private applyFilters(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    return rows.filter((row) =>
      this.filters.every((filter) => {
        const actual = row[filter.column];
        if (filter.type === "eq") return actual === filter.value;
        if (filter.type === "neq") return actual !== filter.value;
        if (filter.type === "gte") return String(actual ?? "") >= String(filter.value ?? "");
        if (filter.type === "is") return actual === filter.value;
        if (filter.type === "not") {
          const op = (filter.value as { op: string; value: unknown }).op;
          const value = (filter.value as { op: string; value: unknown }).value;
          return op === "is" && value === null ? actual != null : true;
        }
        if (filter.type === "ilike") {
          const needle = String(filter.value ?? "").replace(/%/g, "").toLowerCase();
          return String(actual ?? "").toLowerCase().includes(needle);
        }
        return true;
      }),
    );
  }

  private hasFilter(column: string): boolean {
    return this.filters.some((filter) => filter.column === column);
  }

  private referencesIngestMessageKey(): boolean {
    return (
      this.table === "leads" &&
      (this.hasFilter("ingest_message_key") ||
        (this.payload != null && Object.prototype.hasOwnProperty.call(this.payload, "ingest_message_key")))
    );
  }
}

function payload(opts: { messageId?: string | null; email?: string; message?: string }) {
  const email = opts.email ?? "renter@example.com";
  const message =
    opts.message ??
    "I came across your listing for 50 Glenrose Avenue and would be interested in seeing the place.";
  return {
    MessageID: opts.messageId ?? undefined,
    ToFull: [{ Email: `u-${TOKEN}@in.vacantless.com` }],
    FromFull: { Email: FROM },
    ReplyTo: `Renter Example <${email}>`,
    Subject: "Rentals.ca tenant lead for 50 Glenrose Avenue",
    TextBody: `You have a potential new tenant for 50 Glenrose Avenue

Name: Renter Example
Email:  ${email}
Phone: (416) 555-0134
Unit: None
Message : ${message}`,
    Headers: [],
  };
}

function req(body: Record<string, unknown>) {
  return {
    url: `https://app.vacantless.test/api/inbound/lead?key=${SECRET}`,
    headers: new Headers(),
    json: async () => body,
  };
}

async function post(admin: FakeAdmin, body: Record<string, unknown>) {
  const response = await handleInboundLeadPost(req(body) as never, {
    admin: admin as never,
    secret: SECRET,
    now: () => NOW,
    notifyOperators: async () => {
      admin.notifications++;
    },
  });
  return response.json() as Promise<Record<string, unknown>>;
}

async function main() {
  {
  const admin = new FakeAdmin();
  const first = await post(admin, payload({ messageId: "mid-1" }));
  const second = await post(admin, payload({ messageId: "mid-1" }));
  ok("same Message-ID first delivery creates a lead", first.handled === "lead_created", first);
  ok("same Message-ID redelivery returns duplicate", second.handled === "duplicate", second);
  ok("same Message-ID writes no second row", admin.leads.length === 1, admin.leads);
  ok("stored row gets hashed ingest key", typeof admin.leads[0].ingest_message_key === "string");
  }

  {
  const admin = new FakeAdmin();
  const first = await post(admin, payload({ messageId: null }));
  const second = await post(admin, payload({ messageId: null }));
  ok("no Message-ID first delivery still creates a lead", first.handled === "lead_created", first);
  ok("no Message-ID duplicate uses content fallback", second.handled === "duplicate", second);
  ok("no Message-ID fallback writes no second row", admin.leads.length === 1, admin.leads);
  ok("no Message-ID path leaves ingest key null/absent", admin.leads[0].ingest_message_key == null, admin.leads[0]);
  }

  {
  const admin = new FakeAdmin();
  const first = await post(admin, payload({ messageId: "mid-A" }));
  const second = await post(admin, payload({ messageId: "mid-B" }));
  ok("different Message-ID first delivery creates", first.handled === "lead_created", first);
  ok("different Message-ID same renter/message creates another lead", second.handled === "lead_created", second);
  ok("different Message-ID path keeps both rows", admin.leads.length === 2, admin.leads);
  ok("different Message-ID rows get different keys", admin.leads[0].ingest_message_key !== admin.leads[1].ingest_message_key);
  }

  {
  const admin = new FakeAdmin();
  admin.missingIngestMessageKeyColumn = true;
  const first = await post(admin, payload({ messageId: "mid-unmigrated" }));
  const second = await post(admin, payload({ messageId: "mid-unmigrated" }));
  ok("missing ingest column does not block first delivery", first.handled === "lead_created", first);
  ok("missing ingest column falls back to content dedupe", second.handled === "duplicate", second);
  ok("missing ingest column writes no second row", admin.leads.length === 1, admin.leads);
  }

  {
  const admin = new FakeAdmin();
  const messageKey = portalLeadMessageKey("mid-race", `${ORG_ID}:renter@example.com:`);
  admin.leads.push({
    id: "lead_existing",
    organization_id: ORG_ID,
    property_id: null,
    name: "Renter Example",
    email: "renter@example.com",
    phone: "(416) 555-0134",
    source: "Rentals.ca",
    source_detail: null,
    listing_post_id: null,
    status: "new",
    notes: "Existing race row",
    created_at: new Date(NOW).toISOString(),
    ingest_message_key: messageKey,
  });
  admin.keyLookupMissesRemaining = 1;
  const result = await post(admin, payload({ messageId: "mid-race" }));
  ok("unique race returns duplicate instead of storage error", result.handled === "duplicate", result);
  ok("unique race returns the existing lead id", result.lead_id === "lead_existing", result);
  }

  ok(
    "missing-column detector accepts Postgres undefined-column",
    isMissingIngestMessageKeyColumnError({
      code: "42703",
      message: 'column "ingest_message_key" does not exist',
    }),
  );
  ok(
    "missing-column detector accepts PostgREST schema-cache miss",
    isMissingIngestMessageKeyColumnError({
      code: "PGRST204",
      message: "Could not find the 'ingest_message_key' column of 'leads' in the schema cache",
    }),
  );

  const migrationSource = readFileSync(
    new URL("../supabase/migrations/0190_leads_ingest_message_key.sql", import.meta.url),
    "utf8",
  );
  ok("migration adds nullable ingest_message_key", migrationSource.includes("add column if not exists ingest_message_key text"));
  ok("migration creates per-org partial unique index", migrationSource.includes("on public.leads (organization_id, ingest_message_key)"));
  ok("migration ignores null ingest keys", migrationSource.includes("where ingest_message_key is not null"));

  console.log(`\nportal-lead-ingest: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

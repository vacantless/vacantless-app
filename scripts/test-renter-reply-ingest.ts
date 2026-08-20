// Unit tests for S669 renter reply routing.
// Run: npx tsx scripts/test-renter-reply-ingest.ts
import { handleInboundReplyPost } from "../lib/renter-reply-ingest-server";

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

const SECRET = "test-secret";
const NOW = Date.parse("2026-08-20T15:00:00.000Z");
const ORG_ID = "8ea1da48-0000-0000-0000-000000000669";
const LEAD_ID = "lead_669";
const RENTER = "renter@example.com";

type Filter = { type: "eq" | "ilike" | "gte"; column: string; value: unknown };
type Row = Record<string, unknown>;

type OrgRow = Row & {
  id: string;
  name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  public_contact_email: string | null;
  mail_alias: string | null;
};

type LeadRow = Row & {
  id: string;
  organization_id: string;
  name: string | null;
  email: string | null;
  status: string | null;
  property: { address: string | null } | null;
  next_action_at?: string | null;
  next_action_note?: string | null;
  created_at: string;
};

type AuditRow = Row & {
  id: string;
  organization_id: string;
  lead_id: string | null;
  message_key: string;
  sender_email: string;
  matched: boolean;
  status: string;
  drop_reason?: string | null;
  relay_recipients: string[];
  created_at: string;
};

type RelayCall = {
  org: { reply_to_email: string | null };
  eventKey: string;
  renderedOverride?: { subject: string; body: string } | null;
  action?: { label: string; url: string } | null;
};

function orgRow(): OrgRow {
  return {
    id: ORG_ID,
    name: "Agile",
    brand_color: null,
    logo_url: null,
    reply_to_email: "leasing@agileonline.ca",
    public_contact_email: "rentals@agileonline.ca",
    mail_alias: "agile",
  };
}

function leadRow(email: string = RENTER): LeadRow {
  return {
    id: LEAD_ID,
    organization_id: ORG_ID,
    name: "Renter Example",
    email,
    status: "new",
    property: { address: "1551 Assumption" },
    next_action_at: "2026-08-21T12:00:00.000Z",
    next_action_note: "Follow up",
    created_at: "2026-08-20T14:00:00.000Z",
  };
}

class FakeAdmin {
  organizations: OrgRow[] = [orgRow()];
  leads: LeadRow[] = [leadRow()];
  renter_reply_ingests: AuditRow[] = [];
  messages: Row[] = [];
  memberships: Row[] = [{ organization_id: ORG_ID, user_id: "user_1", role: "admin" }];
  relayCalls: RelayCall[] = [];
  private auditSeq = 1;

  auth = {
    admin: {
      getUserById: async (id: string) => ({
        data: { user: { email: id === "user_1" ? "operator@example.com" : null } },
        error: null,
      }),
    },
  };

  from(table: string) {
    return new FakeQuery(this, table);
  }

  nextAuditId() {
    return `audit_${this.auditSeq++}`;
  }
}

class FakeQuery {
  private op: "select" | "insert" | "update" = "select";
  private filters: Filter[] = [];
  private payload: Row | null = null;
  private limitCount: number | null = null;
  private orderSpec: { column: string; ascending: boolean } | null = null;

  constructor(private readonly admin: FakeAdmin, private readonly table: string) {}

  select(_columns?: string) {
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
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  ilike(column: string, value: unknown) {
    this.filters.push({ type: "ilike", column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ type: "gte", column, value });
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.orderSpec = { column, ascending: opts?.ascending ?? true };
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
    if (this.op === "insert") return this.execInsert();
    if (this.op === "update") return this.execUpdate(single);

    let rows = this.applyFilters(this.rowsForTable());
    if (this.orderSpec) {
      const { column, ascending } = this.orderSpec;
      rows = rows.slice().sort((a, b) => {
        const av = String(a[column] ?? "");
        const bv = String(b[column] ?? "");
        return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    if (this.limitCount != null) rows = rows.slice(0, this.limitCount);
    return { data: single ? rows[0] ?? null : rows, error: null };
  }

  private execInsert() {
    if (!this.payload) return { data: null, error: null };
    if (this.table === "renter_reply_ingests") {
      const orgId = String(this.payload.organization_id ?? "");
      const messageKey = String(this.payload.message_key ?? "");
      if (
        this.admin.renter_reply_ingests.some(
          (row) => row.organization_id === orgId && row.message_key === messageKey,
        )
      ) {
        return {
          data: null,
          error: { code: "23505", message: "duplicate renter_reply_ingests key" },
        };
      }
      const row = {
        id: this.admin.nextAuditId(),
        created_at: new Date(NOW).toISOString(),
        ...this.payload,
      } as AuditRow;
      this.admin.renter_reply_ingests.push(row);
      return { data: { id: row.id }, error: null };
    }
    if (this.table === "messages") {
      this.admin.messages.push({ ...this.payload });
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }

  private execUpdate(single: boolean) {
    if (!this.payload) return { data: single ? null : [], error: null };
    const rows = this.applyFilters(this.rowsForTable());
    for (const row of rows) Object.assign(row, this.payload);
    return { data: single ? rows[0] ?? null : rows, error: null };
  }

  private rowsForTable(): Row[] {
    if (this.table === "organizations") return this.admin.organizations;
    if (this.table === "leads") return this.admin.leads;
    if (this.table === "renter_reply_ingests") return this.admin.renter_reply_ingests;
    if (this.table === "memberships") return this.admin.memberships;
    return [];
  }

  private applyFilters(rows: Row[]): Row[] {
    return rows.filter((row) =>
      this.filters.every((filter) => {
        const actual = row[filter.column];
        if (filter.type === "eq") return actual === filter.value;
        if (filter.type === "gte") return String(actual ?? "") >= String(filter.value ?? "");
        if (filter.type === "ilike") {
          const pattern = String(filter.value ?? "").toLowerCase();
          const actualText = String(actual ?? "").toLowerCase();
          if (pattern.includes("%")) return actualText.includes(pattern.replace(/%/g, ""));
          return actualText === pattern;
        }
        return true;
      }),
    );
  }
}

function payload(opts: {
  to?: string;
  from?: string;
  messageId?: string | null;
  subject?: string;
  text?: string;
  headers?: Array<{ Name: string; Value: string }>;
} = {}) {
  return {
    MessageID: opts.messageId === null ? undefined : opts.messageId ?? "mid-1",
    ToFull: [{ Email: opts.to ?? "agile@in.vacantless.com" }],
    FromFull: { Email: opts.from ?? RENTER },
    Subject: opts.subject ?? "Question about the apartment",
    TextBody: opts.text ?? "Can I see the apartment tomorrow?",
    Headers: opts.headers ?? [],
  };
}

function req(body: Record<string, unknown>, key: string | null = SECRET) {
  const url = new URL("https://app.vacantless.test/api/inbound/reply");
  if (key != null) url.searchParams.set("key", key);
  return {
    url: url.toString(),
    headers: new Headers(),
    json: async () => body,
  };
}

async function post(admin: FakeAdmin, body: Record<string, unknown>, key: string | null = SECRET) {
  const response = await handleInboundReplyPost(req(body, key) as never, {
    admin: admin as never,
    secret: SECRET,
    now: () => NOW,
    sendOrgNotification: (async (args: RelayCall) => {
      admin.relayCalls.push(args);
      return {
        delivered: true,
        sentCount: 1,
        attempted: 1,
        recipients: ["leasing@example.com"],
      };
    }) as never,
  });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text };
}

async function main() {
  {
    const admin = new FakeAdmin();
    const res = await post(admin, payload(), "wrong-secret");
    ok("bad secret is unauthorized", res.status === 401, res);
    ok("bad secret does not relay", admin.relayCalls.length === 0);
    ok("bad secret does not audit", admin.renter_reply_ingests.length === 0);
  }

  {
    const admin = new FakeAdmin();
    const res = await post(admin, payload({ to: "u-abcdefghijklmnopqrstuvwx@in.vacantless.com" }));
    ok("u-token route is not treated as alias", res.json?.handled === "org_unresolved", res);
    ok("u-token route does not relay", admin.relayCalls.length === 0);
    ok("u-token route does not audit without org", admin.renter_reply_ingests.length === 0);
  }

  {
    const admin = new FakeAdmin();
    const res = await post(
      admin,
      payload({ headers: [{ Name: "Auto-Submitted", Value: "auto-replied" }] }),
    );
    ok("auto-loop reply is dropped", res.json?.handled === "auto_reply", res);
    ok("auto-loop reply does not relay", admin.relayCalls.length === 0);
    ok("auto-loop reply gets drop audit", admin.renter_reply_ingests[0]?.status === "dropped", admin.renter_reply_ingests);
    ok("auto-loop audit records reason", admin.renter_reply_ingests[0]?.drop_reason === "auto_reply", admin.renter_reply_ingests[0]);
  }

  {
    const admin = new FakeAdmin();
    const first = await post(admin, payload({ messageId: "mid-dup" }));
    const second = await post(admin, payload({ messageId: "mid-dup" }));
    ok("first matching reply relays", first.json?.handled === "relayed", first);
    ok("duplicate retry is deduped", second.json?.handled === "duplicate", second);
    ok("duplicate retry does not relay twice", admin.relayCalls.length === 1, admin.relayCalls);
    ok("matching reply appends metadata note", admin.messages.length === 1, admin.messages);
    ok("matching reply bumps untouched lead", admin.leads[0].status === "replied", admin.leads[0]);
    ok("audit does not persist subject", !Object.prototype.hasOwnProperty.call(admin.renter_reply_ingests[0], "subject"));
    ok("audit does not persist raw body", !Object.prototype.hasOwnProperty.call(admin.renter_reply_ingests[0], "body"));
    ok("audit does not persist raw headers", !Object.prototype.hasOwnProperty.call(admin.renter_reply_ingests[0], "headers"));
  }

  {
    const admin = new FakeAdmin();
    admin.leads = [];
    const res = await post(admin, payload({ messageId: "mid-unmatched" }));
    ok("unmatched sender still relays", res.json?.handled === "relayed" && res.json?.matched === false, res);
    ok("unmatched relay subject says unmatched", admin.relayCalls[0]?.renderedOverride?.subject === "Renter reply - unmatched", admin.relayCalls[0]);
    ok("unmatched relay keeps renter as reply-to", admin.relayCalls[0]?.org.reply_to_email === RENTER, admin.relayCalls[0]);
    ok("unmatched relay appends no lead note", admin.messages.length === 0, admin.messages);
  }

  {
    const admin = new FakeAdmin();
    admin.renter_reply_ingests = Array.from({ length: 10 }, (_, i) => ({
      id: `seed_${i}`,
      organization_id: ORG_ID,
      lead_id: null,
      message_key: `seed_key_${i}`,
      sender_email: `renter${i}@example.com`,
      matched: false,
      status: "relayed",
      relay_recipients: ["leasing@example.com"],
      created_at: new Date(NOW - 5 * 60 * 1000).toISOString(),
    }));
    const res = await post(admin, payload({ messageId: "mid-rate" }));
    const latest = admin.renter_reply_ingests.find((row) => row.message_key !== undefined && row.id.startsWith("audit_"));
    ok("rate limit returns handled", res.json?.handled === "rate_limited", res);
    ok("rate limit does not relay", admin.relayCalls.length === 0, admin.relayCalls);
    ok("rate limit stamps audit", latest?.status === "rate_limited", latest);
  }

  console.log(`\nrenter-reply-ingest: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();

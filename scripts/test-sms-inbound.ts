// Run with: npx tsx scripts/test-sms-inbound.ts
import { createHmac } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseOpenPhoneInbound, verifyOpenPhoneSignature } from "../lib/sms";
import { applyInboundSms } from "../lib/sms-inbound";

let pass = 0;
let fail = 0;

function eq(name: string, got: unknown, want: unknown) {
  if (got === want) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name} - got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

function deepEq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name} - got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const secretBytes = Buffer.from("s521-openphone-secret");
const secret = secretBytes.toString("base64");
const ts = 1784476800000;
const rawBody = JSON.stringify({
  type: "message.received",
  data: {
    object: {
      direction: "incoming",
      from: "+15195551234",
      to: "+16475598281",
      body: "Is this still available?",
    },
  },
});
const sig = createHmac("sha256", secretBytes)
  .update(`${ts}.${rawBody}`, "utf-8")
  .digest("base64");
const header = `hmac;1;${ts};${sig}`;

ok(
  "openphone signature accepts valid request",
  verifyOpenPhoneSignature(secret, header, rawBody, { nowMs: ts + 1000 }),
);
ok(
  "openphone signature rejects tampered body",
  !verifyOpenPhoneSignature(secret, header, rawBody.replace("available", "open"), {
    nowMs: ts + 1000,
  }),
);
ok(
  "openphone signature rejects wrong key",
  !verifyOpenPhoneSignature(Buffer.from("wrong").toString("base64"), header, rawBody, {
    nowMs: ts + 1000,
  }),
);
ok(
  "openphone signature rejects stale timestamp",
  !verifyOpenPhoneSignature(secret, header, rawBody, { nowMs: ts + 301000 }),
);
ok(
  "openphone signature rejects malformed header",
  !verifyOpenPhoneSignature(secret, "hmac;1;not-a-time;abc", rawBody, { nowMs: ts }),
);
ok(
  "openphone signature accepts one of multiple signatures",
  verifyOpenPhoneSignature(secret, `hmac;1;${ts};bad, ${header}`, rawBody, {
    nowMs: ts,
  }),
);

deepEq(
  "parse message.received incoming",
  parseOpenPhoneInbound(JSON.parse(rawBody)),
  {
    kind: "message_received",
    from: "+15195551234",
    to: "+16475598281",
    body: "Is this still available?",
  },
);
eq(
  "parse delivered -> null",
  parseOpenPhoneInbound({
    type: "message.delivered",
    data: { object: { direction: "outgoing", from: "+1", to: "+2", body: "x" } },
  }),
  null,
);
eq(
  "parse call -> null",
  parseOpenPhoneInbound({
    type: "call.completed",
    data: { object: { direction: "incoming", from: "+1", to: "+2" } },
  }),
  null,
);

type Table = "leads" | "tenants" | "messages";

function fakeAdmin(seed: {
  leads?: any[];
  tenants?: any[];
  messages?: any[];
}) {
  const state = {
    leads: seed.leads ?? [],
    tenants: seed.tenants ?? [],
    messages: seed.messages ?? [],
    updates: [] as any[],
  };

  const api = {
    from(table: Table) {
      return {
        select() {
          return {
            eq(column: string, value: unknown) {
              return Promise.resolve({
                data: state[table].filter((row: any) => row[column] === value),
                error: null,
              });
            },
          };
        },
        update(values: Record<string, unknown>) {
          return {
            in(column: string, ids: string[]) {
              state.updates.push({ table, values, column, ids });
              for (const row of state[table]) {
                if (ids.includes(row[column])) Object.assign(row, values);
              }
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
        insert(rows: any[] | any) {
          const list = Array.isArray(rows) ? rows : [rows];
          state[table].push(...list);
          return Promise.resolve({ data: list, error: null });
        },
      };
    },
  };

  return { admin: api as unknown as Pick<SupabaseClient, "from">, state };
}

async function main() {
  {
    const { admin, state } = fakeAdmin({
      leads: [
        {
          id: "lead-1",
          organization_id: "org-1",
          phone_e164: "+15195551234",
          sms_opt_out: false,
        },
        {
          id: "lead-2",
          organization_id: "org-2",
          phone_e164: "+15195551234",
          sms_opt_out: true,
        },
      ],
      tenants: [{ id: "tenant-1", phone_e164: "+15195551234", sms_opt_out: false }],
    });
    const result = await applyInboundSms(admin, {
      from: "(519) 555-1234",
      body: "STOP please",
    });
    eq("STOP action", result.action, "stop");
    eq("STOP matches both leads", result.matchedLeads, 2);
    eq("STOP updates only changing lead", result.updatedLeads, 1);
    eq("STOP updates tenant", result.updatedTenants, 1);
    eq("STOP logs one affected lead message", result.messagesInserted, 1);
    eq("STOP flips lead opt-out", state.leads[0].sms_opt_out, true);
    eq("STOP leaves already opted-out lead", state.leads[1].sms_opt_out, true);
    eq("STOP timeline body", state.messages[0].body, "Renter texted STOP \u2014 opted out of SMS");
  }

  {
    const { admin, state } = fakeAdmin({
      leads: [
        {
          id: "lead-1",
          organization_id: "org-1",
          phone_e164: "+15195551234",
          sms_opt_out: false,
        },
        {
          id: "lead-2",
          organization_id: "org-2",
          phone_e164: "+15195551234",
          sms_opt_out: false,
        },
      ],
      tenants: [{ id: "tenant-1", phone_e164: "+15195551234", sms_opt_out: false }],
    });
    const result = await applyInboundSms(admin, {
      from: "+15195551234",
      body: "  Is parking included?  ",
    });
    eq("normal reply action", result.action, "reply");
    eq("normal reply logs each matched lead", result.messagesInserted, 2);
    eq("normal reply does not update leads", result.updatedLeads, 0);
    eq("normal reply does not update tenants", result.updatedTenants, 0);
    deepEq(
      "normal reply message rows",
      state.messages.map((m: any) => ({
        organization_id: m.organization_id,
        lead_id: m.lead_id,
        channel: m.channel,
        direction: m.direction,
        body: m.body,
      })),
      [
        {
          organization_id: "org-1",
          lead_id: "lead-1",
          channel: "sms",
          direction: "inbound",
          body: "Is parking included?",
        },
        {
          organization_id: "org-2",
          lead_id: "lead-2",
          channel: "sms",
          direction: "inbound",
          body: "Is parking included?",
        },
      ],
    );
  }

  {
    const { admin, state } = fakeAdmin({});
    const result = await applyInboundSms(admin, { from: "+15195559999", body: "Hello?" });
    eq("unknown sender is reply no-op", result.action, "reply");
    eq("unknown sender has no messages", state.messages.length, 0);
  }

  console.log(`\nsms-inbound: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

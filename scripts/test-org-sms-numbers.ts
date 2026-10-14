// Run with: npx tsx scripts/test-org-sms-numbers.ts
// S717: each landlord's own texting number (0248).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanOwnNumber,
  isCanadianNumber,
  orgForTextingNumber,
  orgOwnSmsNumber,
  routeSms,
} from "../lib/org-sms-numbers";
import { applyInboundSms, logInboundCall } from "../lib/sms-inbound";
import { isOwnNumberSmsConfigured } from "../lib/sms";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name} - got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// Canadian numbers only.
eq("Windsor 226", isCanadianNumber("(226) 555-0123"), true);
eq("Windsor 519 with +1", isCanadianNumber("+1 519 555 0123"), true);
eq("Toronto 647", isCanadianNumber("647-555-0123"), true);
eq("Detroit 313 is not Canadian", isCanadianNumber("313-555-0123"), false);
eq("New York 212 is not Canadian", isCanadianNumber("+12125550123"), false);
eq("UK number is not Canadian", isCanadianNumber("+447700900123"), false);
eq("blank is not Canadian", isCanadianNumber(""), false);
eq("clean own number", cleanOwnNumber("226.555.0123"), "+12265550123");
eq("own number must be Canadian", cleanOwnNumber("313 555 0123"), null);
eq("own number must be a number", cleanOwnNumber("abc"), null);

// Routing.
eq(
  "own number texts a Canadian renter from itself",
  routeSms({ ownNumber: "+12265550123", onSharedNumber: false, to: "519-555-0199" }),
  { kind: "own", from: "+12265550123" },
);
eq(
  "own number never texts a US renter",
  routeSms({ ownNumber: "+12265550123", onSharedNumber: true, to: "313-555-0199" }),
  { kind: "none", reason: "not_canadian_number" },
);
eq(
  "no own number, on shared number: shared",
  routeSms({ ownNumber: null, onSharedNumber: true, to: "313-555-0199" }),
  { kind: "shared" },
);
eq(
  "no own number, not on shared: no text",
  routeSms({ ownNumber: null, onSharedNumber: false, to: "519-555-0199" }),
  { kind: "none", reason: "org_not_on_sms" },
);

// Transport readiness for own numbers.
eq("own-number transport needs SMS_LIVE", isOwnNumberSmsConfigured({ TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t" } as any), false);
eq(
  "own-number transport needs only live + account keys",
  isOwnNumberSmsConfigured({ SMS_LIVE: "true", TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t" } as any),
  true,
);
eq("own-number transport needs keys", isOwnNumberSmsConfigured({ SMS_LIVE: "true" } as any), false);

// Fake admin client with org_sms_numbers, leads, tenants, messages.
function fakeAdmin(seed: Record<string, any[]>, opts: { numbersTableMissing?: boolean } = {}) {
  const state: Record<string, any[]> = { org_sms_numbers: [], leads: [], tenants: [], messages: [], ...seed };
  const api = {
    from(table: string) {
      if (table === "org_sms_numbers" && opts.numbersTableMissing) {
        const err = { data: null, error: { message: "relation does not exist" } };
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(err) }) }) };
      }
      if (table === "platform_org_switches") {
        return {
          select: () => ({
            eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
          }),
        };
      }
      return {
        select() {
          return {
            eq(column: string, value: unknown) {
              const rows = (state[table] ?? []).filter((r) => r[column] === value);
              const p: any = Promise.resolve({ data: rows, error: null });
              p.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
              return p;
            },
          };
        },
        update(values: Record<string, unknown>) {
          return {
            in(column: string, ids: string[]) {
              for (const r of state[table] ?? []) if (ids.includes(r[column])) Object.assign(r, values);
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
        insert(rows: any) {
          const list = Array.isArray(rows) ? rows : [rows];
          state[table].push(...list);
          return Promise.resolve({ data: list, error: null });
        },
      };
    },
  };
  return { admin: api as unknown as Pick<SupabaseClient, "from">, state };
}

const AGILE = "921f7c08-98af-428f-a238-36f4a781b0de";
const LANDLORD2 = "org-landlord-2";

async function main() {
  {
    const { admin } = fakeAdmin({
      org_sms_numbers: [
        { organization_id: LANDLORD2, phone_e164: "+12265550123", enabled: true },
        { organization_id: "org-paused", phone_e164: "+12265550999", enabled: false },
      ],
    });
    eq("own number when on", await orgOwnSmsNumber(admin, LANDLORD2), "+12265550123");
    eq("no own number when off", await orgOwnSmsNumber(admin, "org-paused"), null);
    eq("no own number without a row", await orgOwnSmsNumber(admin, AGILE), null);
    eq("no own number without an org", await orgOwnSmsNumber(admin, null), null);
    eq("owner of an incoming number", await orgForTextingNumber(admin, "(226) 555-0123"), LANDLORD2);
    eq("a paused number still names its owner", await orgForTextingNumber(admin, "+12265550999"), "org-paused");
    eq("unknown number has no owner", await orgForTextingNumber(admin, "+15195550000"), null);
  }

  {
    const { admin } = fakeAdmin({}, { numbersTableMissing: true });
    eq("missing table: no own number", await orgOwnSmsNumber(admin, LANDLORD2), null);
    eq("missing table: no owner", await orgForTextingNumber(admin, "+12265550123"), null);
  }

  // A renter known to Agile AND landlord 2 texts landlord 2's own number.
  const renter = "+15195551234";
  const seed = () => ({
    leads: [
      { id: "lead-agile", organization_id: AGILE, phone_e164: renter, sms_opt_out: false },
      { id: "lead-l2", organization_id: LANDLORD2, phone_e164: renter, sms_opt_out: false },
    ],
    tenants: [{ id: "tenant-agile", organization_id: AGILE, phone_e164: renter, sms_opt_out: false }],
  });

  {
    const { admin, state } = fakeAdmin(seed());
    const r = await applyInboundSms(admin, { from: renter, body: "Is parking included?", ownerOrgId: LANDLORD2 });
    eq("reply to own number files to that landlord only", r.repliedLeads, [{ leadId: "lead-l2", orgId: LANDLORD2 }]);
    eq("one message logged", state.messages.length, 1);
    eq("logged at landlord 2", state.messages[0].organization_id, LANDLORD2);
  }

  {
    const { admin, state } = fakeAdmin(seed());
    const r = await applyInboundSms(admin, { from: renter, body: "STOP", ownerOrgId: LANDLORD2 });
    eq("STOP to own number opts out that landlord only", r.updatedLeads, 1);
    eq("landlord 2 lead opted out", state.leads[1].sms_opt_out, true);
    eq("Agile lead untouched", state.leads[0].sms_opt_out, false);
    eq("Agile tenant untouched", state.tenants[0].sms_opt_out, false);
  }

  {
    // No owner (shared QUO number): Agile is built in, landlord 2 is not.
    const { admin, state } = fakeAdmin(seed());
    const r = await applyInboundSms(admin, { from: renter, body: "Is parking included?" });
    eq("shared number still files to Agile only", r.repliedLeads, [{ leadId: "lead-agile", orgId: AGILE }]);
    eq("shared number logged at Agile", state.messages[0].organization_id, AGILE);
  }

  {
    const { admin, state } = fakeAdmin(seed());
    const c = await logInboundCall(admin, { from: renter, answered: false, voicemail: false, ownerOrgId: LANDLORD2 });
    eq("call to own number logged at that landlord only", c.calledLeads, [{ leadId: "lead-l2", orgId: LANDLORD2 }]);
    eq("call row is at landlord 2", state.messages[0].organization_id, LANDLORD2);
  }

  console.log(`org-sms-numbers: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();

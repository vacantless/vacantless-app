// S742d: closing an account removes its secrets. A fake admin records what is
// deleted, updated and read.
import { describeWipe, wipeOrgSecrets } from "../lib/account-closure-server";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error("FAIL:", name);
  }
}

type Op = { table: string; op: string; filters: [string, unknown][]; patch?: unknown };
function fakeAdmin(rows: Record<string, unknown[]>) {
  const ops: Op[] = [];
  const admin = {
    from: (table: string) => {
      const make = (op: string, patch?: unknown) => {
        const o: Op = { table, op, filters: [], patch };
        ops.push(o);
        const chain: any = {
          eq: (c: string, v: unknown) => { o.filters.push([c, v]); return chain; },
          neq: (c: string, v: unknown) => { o.filters.push([c, v]); return chain; },
          in: (c: string, v: unknown) => { o.filters.push([c, v]); return chain; },
          select: async () => ({ data: rows[table] ?? [], error: null }),
          maybeSingle: async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null }),
          then: (res: any) => res({ data: rows[table] ?? [], error: null }),
        };
        return chain;
      };
      return {
        delete: () => make("delete"),
        update: (patch: unknown) => make("update", patch),
        select: () => make("select"),
      };
    },
  };
  return { admin, ops };
}

async function main() {
  const { admin, ops } = fakeAdmin({
    distribution_channel_sessions: [{ channel: "kijiji" }, { channel: "zumper" }, { channel: "facebook_feed" }],
    site_signin_windows: [{ id: "w1" }],
    bank_connections: [{ id: "c1" }],
    bank_connection_secrets: [{ connection_id: "c1" }],
    distribution_channel_accounts: [{ id: "a1" }, { id: "a2" }],
    org_sms_numbers: [], // no number
  });
  const r = await wipeOrgSecrets(admin as any, "org1");
  ok("three site logins removed", r.siteLogins === 3);
  ok("sign-in window removed", r.signinWindows === 1);
  ok("bank token removed", r.bankSecrets === 1);
  ok("bank connection marked disconnected", r.bankConnections === 1);
  ok("posting accounts paused", r.channelAccountsPaused === 2);
  ok("no number is none", r.textingNumber === "none");
  ok("no errors", r.errors.length === 0);

  const del = ops.filter((o) => o.op === "delete").map((o) => o.table);
  ok("deletes sessions, windows and bank secrets", del.includes("distribution_channel_sessions") && del.includes("site_signin_windows") && del.includes("bank_connection_secrets"));
  ok("never deletes renters or tenancies", !del.includes("leads") && !del.includes("tenancies") && !del.includes("properties"));
  ok("every delete is scoped to the org or its rows", ops.filter((o) => o.op === "delete").every((o) => o.filters.length > 0));
  const paused = ops.find((o) => o.table === "distribution_channel_accounts" && o.op === "update");
  ok("accounts set to paused", (paused?.patch as any)?.account_status === "paused");
  const disc = ops.find((o) => o.table === "bank_connections" && o.op === "update");
  ok("connections set to disconnected", (disc?.patch as any)?.status === "disconnected");

  const line = describeWipe(r);
  ok("email line names the counts", line.includes("3 site logins removed") && line.includes("1 bank token removed") && line.includes("no texting number"));

  // a throwing table never stops the rest
  const broken = {
    from: (table: string) => {
      if (table === "distribution_channel_sessions") throw new Error("down");
      return (fakeAdmin({}).admin as any).from(table);
    },
  };
  const r2 = await wipeOrgSecrets(broken as any, "org1");
  ok("one failure is reported, the rest still runs", r2.errors.length === 1 && r2.errors[0].startsWith("sessions:"));
  ok("failure shows in the email line", describeWipe(r2).includes("errors:"));

  console.log(`\naccount-closure-server: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();

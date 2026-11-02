// S742c: claim before send. A fake client records the chain each helper builds
// and answers with the rows a real update().select() would return.
import { claimNull, claimStep, releaseClaim } from "../lib/claim-stamp";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error("FAIL:", name);
  }
}

type Call = { table: string; patch: Record<string, unknown>; eq: [string, unknown][]; is: [string, null][]; or: string[]; select: string };
function fakeClient(answer: () => { data: unknown[] | null; error: { message: string } | null }) {
  const calls: Call[] = [];
  const client = {
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => {
        const call: Call = { table, patch, eq: [], is: [], or: [], select: "" };
        calls.push(call);
        const chain = {
          eq: (c: string, v: unknown) => { call.eq.push([c, v]); return chain; },
          is: (c: string, v: null) => { call.is.push([c, v]); return chain; },
          or: (f: string) => { call.or.push(f); return chain; },
          select: async (cols: string) => { call.select = cols; return answer(); },
        };
        return chain;
      },
    }),
  };
  return { client, calls };
}

async function main() {
  // claimNull: writes now where column is null
  {
    const { client, calls } = fakeClient(() => ({ data: [{ reminder_24h_sent_at: "x" }], error: null }));
    const r = await claimNull(client, "showings", { id: "s1" }, "reminder_24h_sent_at", {}, "2026-11-01T00:00:00.000Z");
    ok("null claim claimed", r.outcome === "claimed");
    ok("null claim sets the stamp", calls[0]?.patch.reminder_24h_sent_at === "2026-11-01T00:00:00.000Z");
    ok("null claim matches the row", calls[0]?.eq[0]?.[0] === "id" && calls[0]?.eq[0]?.[1] === "s1");
    ok("null claim requires null", calls[0]?.is[0]?.[0] === "reminder_24h_sent_at");
  }
  {
    const { client } = fakeClient(() => ({ data: [], error: null }));
    const r = await claimNull(client, "showings", { id: "s1" }, "c");
    ok("zero rows is taken", r.outcome === "taken");
  }
  {
    const { client } = fakeClient(() => ({ data: null, error: { message: "boom" } }));
    const r = await claimNull(client, "showings", { id: "s1" }, "c");
    ok("db error is error with message", r.outcome === "error" && r.error === "boom");
  }
  {
    const client = { from: () => { throw new Error("down"); } } as any;
    const r = await claimNull(client, "showings", { id: "s1" }, "c");
    ok("throw is error", r.outcome === "error");
  }
  // claimStep: writes step where null or below
  {
    const { client, calls } = fakeClient(() => ({ data: [{ nurture_step_sent: 2 }], error: null }));
    const r = await claimStep(client, "leads", { id: "l1" }, "nurture_step_sent", 2, { nurture_last_sent_at: "t" });
    ok("step claim claimed", r.outcome === "claimed");
    ok("step claim writes step and extra", calls[0]?.patch.nurture_step_sent === 2 && calls[0]?.patch.nurture_last_sent_at === "t");
    ok("step claim condition is null-or-below", calls[0]?.or[0] === "nurture_step_sent.is.null,nurture_step_sent.lt.2");
  }
  {
    const { client } = fakeClient(() => ({ data: [], error: null }));
    const r = await claimStep(client, "leads", { id: "l1" }, "nurture_step_sent", 2);
    ok("step already written is taken", r.outcome === "taken");
  }
  // releaseClaim restores and never throws
  {
    const { client, calls } = fakeClient(() => ({ data: [], error: null }));
    await releaseClaim(client, "showings", { id: "s1" }, { reminder_24h_sent_at: null });
    ok("release writes the restore patch", calls[0]?.patch.reminder_24h_sent_at === null && calls[0]?.eq[0]?.[1] === "s1");
  }
  {
    const client = { from: () => { throw new Error("down"); } } as any;
    let threw = false;
    try { await releaseClaim(client, "showings", { id: "s1" }, { c: null }); } catch { threw = true; }
    ok("release swallows errors", !threw);
  }
  // two runners, one row: only one claims
  {
    let taken = false;
    const { client } = fakeClient(() => { if (taken) return { data: [], error: null }; taken = true; return { data: [{ c: "x" }], error: null }; });
    const a = await claimNull(client, "t", { id: 1 }, "c");
    const b = await claimNull(client, "t", { id: 1 }, "c");
    ok("second runner is turned away", a.outcome === "claimed" && b.outcome === "taken");
  }
  console.log(`\nclaim-stamp: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();

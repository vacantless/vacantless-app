// S750: a "yes", "ok", thumbs-up or tapback reply confirms the renter's next viewing.
// Run: npx tsx scripts/test-s750-sms-confirm.ts
import { confirmShowingFromText, isConfirmReply } from "../lib/sms-confirm-reply";

let pass = 0;
let fail = 0;
function eq(got: unknown, want: unknown, msg: string) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else {
    fail++;
    console.error(`FAIL: ${msg} - got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// Chainable fake: records filters, returns seeded rows for selects.
function fakeClient(showings: any[]) {
  const state = { showings: showings.map((s) => ({ ...s })), messages: [] as any[] };
  const from = (table: string) => {
    const filters: ((r: any) => boolean)[] = [];
    let mode: "select" | "update" = "select";
    let patch: any = null;
    let lim = Infinity;
    const q: any = {
      select: () => q,
      update: (v: any) => ((mode = "update"), (patch = v), q),
      insert: (row: any) => {
        (state as any)[table].push(row);
        return Promise.resolve({ data: row, error: null });
      },
      eq: (c: string, v: any) => (filters.push((r) => r[c] === v), q),
      is: (c: string, v: any) => (filters.push((r) => (r[c] ?? null) === v), q),
      gte: (c: string, v: any) => (filters.push((r) => r[c] >= v), q),
      lte: (c: string, v: any) => (filters.push((r) => r[c] <= v), q),
      order: (c: string) => (filters.push(() => true), (q._order = c), q),
      limit: (n: number) => ((lim = n), q),
      then: (res: any) => {
        let rows = (state as any)[table].filter((r: any) => filters.every((f) => f(r)));
        if (q._order) rows = rows.slice().sort((a: any, b: any) => String(a[q._order]).localeCompare(String(b[q._order])));
        return Promise.resolve({ data: rows.slice(0, lim), error: null }).then(res);
      },
      maybeSingle: () => {
        const rows = (state as any)[table].filter((r: any) => filters.every((f) => f(r)));
        if (mode === "update") rows.forEach((r: any) => Object.assign(r, patch));
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
    };
    return q;
  };
  return { client: { from }, state };
}

async function main() {
  for (const y of ["Yes", "yes!", "YES", "Y", "ok", "Okay 👍", "👍", "👍🏽", "✅", "Yes see you then", "Yes I'll be there", "Confirmed", "Sounds good", "Yes, thank you", "Liked “Your viewing at 1551 Assumption is today”", "Perfect thanks", "will be there"]) {
    eq(isConfirmReply(y), true, `confirm: ${y}`);
  }
  for (const n of ["", "Is parking included?", "No", "Yes but can we do 6 instead", "Can't make it", "ok I'll be late", "Yes?", "I need to reschedule", "STOP", "hello", "Yes I want to cancel", "thanks", "Is it still available", "Yes I'm interested in the 2 bedroom on the second floor with parking please"]) {
    eq(isConfirmReply(n), false, `not a confirm: ${n}`);
  }

  const now = "2026-11-04T20:00:00.000Z";
  const base = { organization_id: "org-1", lead_id: "lead-1", outcome: "scheduled", confirmed_at: null };
  {
    const { client, state } = fakeClient([
      { ...base, id: "later", scheduled_at: "2026-11-06T22:00:00.000Z" },
      { ...base, id: "next", scheduled_at: "2026-11-05T22:00:00.000Z" },
      { ...base, id: "past", scheduled_at: "2026-11-01T22:00:00.000Z" },
      { ...base, id: "other-org", organization_id: "org-2", scheduled_at: "2026-11-05T21:00:00.000Z" },
    ]);
    const r = await confirmShowingFromText(client, { orgId: "org-1", leadId: "lead-1", nowIso: now });
    eq(r, { confirmed: true, showingId: "next" }, "confirms the soonest upcoming viewing in this account");
    eq(state.showings.find((s) => s.id === "next").confirmed_by, "renter", "confirmed_by renter");
    eq(state.showings.find((s) => s.id === "later").confirmed_at, null, "later viewing untouched");
    eq(state.showings.find((s) => s.id === "other-org").confirmed_at, null, "other account untouched");
    eq(state.messages.map((m) => m.body), ["Renter confirmed their viewing by text"], "timeline note");
    const again = await confirmShowingFromText(client, { orgId: "org-1", leadId: "lead-1", nowIso: now });
    eq(again.showingId, "later", "a second yes confirms the next unconfirmed one only if any (idempotent per viewing)");
  }
  {
    const { client, state } = fakeClient([{ ...base, id: "far", scheduled_at: "2026-11-20T22:00:00.000Z" }, { ...base, id: "done", outcome: "cancelled", scheduled_at: "2026-11-05T22:00:00.000Z" }]);
    const r = await confirmShowingFromText(client, { orgId: "org-1", leadId: "lead-1", nowIso: now });
    eq(r, { confirmed: false }, "nothing within 7 days, cancelled viewings skipped");
    eq(state.messages.length, 0, "no note when nothing confirmed");
  }

  console.log(`\ns750 sms confirm: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});

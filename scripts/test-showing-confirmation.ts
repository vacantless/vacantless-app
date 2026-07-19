// Run with: npx tsx scripts/test-showing-confirmation.ts
import { readFileSync } from "node:fs";
import { confirmShowingByCancelToken } from "../lib/showing-confirmation";

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

function eq(name: string, got: unknown, want: unknown) {
  if (got === want) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name} - got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

type ShowingRow = {
  id: string;
  cancel_token: string;
  outcome: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  organization_id: string | null;
  lead_id: string | null;
};

function fakeClient(initial: ShowingRow | null) {
  const state = {
    row: initial ? { ...initial } : null,
    messages: [] as unknown[],
    updates: [] as unknown[],
  };
  return {
    state,
    client: {
      from(table: string) {
        if (table === "messages") {
          return {
            insert(value: unknown) {
              state.messages.push(value);
              return Promise.resolve({ error: null });
            },
          };
        }
        if (table !== "showings") throw new Error(`unexpected table ${table}`);
        return {
          update(value: unknown) {
            state.updates.push(value);
            const filters: Record<string, unknown> = {};
            return {
              eq(column: string, expected: unknown) {
                filters[column] = expected;
                return this;
              },
              is(column: string, expected: unknown) {
                filters[column] = expected;
                return this;
              },
              select() {
                return this;
              },
              async maybeSingle() {
                const row = state.row;
                if (
                  !row ||
                  row.cancel_token !== filters.cancel_token ||
                  row.outcome !== filters.outcome ||
                  row.confirmed_at !== filters.confirmed_at
                ) {
                  return { data: null, error: null };
                }
                Object.assign(row, value);
                return {
                  data: {
                    id: row.id,
                    organization_id: row.organization_id,
                    lead_id: row.lead_id,
                  },
                  error: null,
                };
              },
            };
          },
        };
      },
    },
  };
}

async function testConfirmHelper() {
  const scheduled = fakeClient({
    id: "showing_1",
    cancel_token: "tok_live",
    outcome: "scheduled",
    confirmed_at: null,
    confirmed_by: null,
    organization_id: "org_1",
    lead_id: "lead_1",
  });

  const first = await confirmShowingByCancelToken(
    scheduled.client,
    "tok_live",
    "2026-07-16T10:00:00.000Z",
  );
  ok("scheduled showing confirms", first.ok && first.confirmed);
  eq("confirmed_at set", scheduled.state.row?.confirmed_at, "2026-07-16T10:00:00.000Z");
  eq("confirmed_by renter", scheduled.state.row?.confirmed_by, "renter");
  eq("one message inserted", scheduled.state.messages.length, 1);
  ok(
    "message body records renter confirmation",
    JSON.stringify(scheduled.state.messages[0]).includes("Renter confirmed their viewing"),
  );

  const second = await confirmShowingByCancelToken(
    scheduled.client,
    "tok_live",
    "2026-07-16T10:01:00.000Z",
  );
  ok("second confirmation is idempotent no-op", second.ok && !second.confirmed);
  eq("second confirmation does not duplicate message", scheduled.state.messages.length, 1);

  const cancelled = fakeClient({
    id: "showing_2",
    cancel_token: "tok_cancelled",
    outcome: "cancelled",
    confirmed_at: null,
    confirmed_by: null,
    organization_id: "org_1",
    lead_id: "lead_2",
  });
  const closed = await confirmShowingByCancelToken(cancelled.client, "tok_cancelled");
  ok("non-scheduled showing no-ops", closed.ok && !closed.confirmed);
  eq("non-scheduled inserts no message", cancelled.state.messages.length, 0);

  const unknown = fakeClient(null);
  const missing = await confirmShowingByCancelToken(unknown.client, "tok_missing");
  ok("unknown token no-ops", missing.ok && !missing.confirmed);
  eq("unknown token inserts no message", unknown.state.messages.length, 0);
}

async function testReminderEmail() {
  process.env.BREVO_API_KEY = "test-key";
  process.env.BREVO_SENDER_EMAIL = "leads@vacantless.test";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.vacantless.test/";

  const sends: unknown[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sends.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response("{}", { status: 201 });
  }) as typeof fetch;

  const { sendShowingReminder } = await import("../lib/email");
  const base = {
    lead_id: "lead_1",
    kind: "24h" as const,
    renter_name: "Gurpreet Singh",
    renter_email: "gurpreet@example.com",
    org_name: "Agile Rentals",
    brand_color: "#111827",
    logo_url: null,
    reply_to_email: "rentals@agileonline.ca",
    property_address: "833 Pillette Rd, Unit 20",
    leasing_phone: "226-773-7555",
    when_label: "Friday, July 17 at 5:30 PM EDT",
  };

  sends.length = 0;
  await sendShowingReminder({ ...base, cancel_token: "tok live/space" });
  const withToken = sends[0] as { htmlContent?: string };
  const withHtml = String(withToken.htmlContent);
  ok("reminder renders confirm button when token present",
    withHtml.includes("✓ Confirm you're coming"));
  ok("reminder renders confirm URL when token present",
    withHtml.includes("https://app.vacantless.test/showing/confirm/tok%20live%2Fspace"));
  ok("reminder renders reschedule link when token present",
    withHtml.includes("Can't make it? Reschedule") &&
      withHtml.includes("https://app.vacantless.test/showing/reschedule/tok%20live%2Fspace"));
  ok("reminder renders cancel link when token present",
    withHtml.includes("Cancel this viewing") &&
      withHtml.includes("https://app.vacantless.test/showing/cancel/tok%20live%2Fspace"));

  sends.length = 0;
  await sendShowingReminder({ ...base, cancel_token: null });
  const withoutToken = sends[0] as { htmlContent?: string };
  const withoutHtml = String(withoutToken.htmlContent);
  ok("reminder omits confirm button when token absent",
    !withoutHtml.includes("Confirm you're coming"));
  ok("reminder omits confirm URL when token absent",
    !withoutHtml.includes("/showing/confirm/"));
  ok("reminder omits reschedule URL when token absent",
    !withoutHtml.includes("/showing/reschedule/"));
  ok("reminder omits cancel URL when token absent",
    !withoutHtml.includes("/showing/cancel/"));
}

function testSourceWiring() {
  const routeSource = readFileSync(
    new URL("../app/api/cron/reminders/route.ts", import.meta.url),
    "utf8",
  );
  ok("reminder cron selects cancel_token", routeSource.includes("id, cancel_token, scheduled_at"));
  ok("reminder cron passes cancel_token into email payload",
    routeSource.includes("cancel_token: row.cancel_token ?? null"));

  const pageSource = readFileSync(
    new URL("../app/showing/confirm/[token]/page.tsx", import.meta.url),
    "utf8",
  );
  const actionSource = readFileSync(
    new URL("../app/showing/confirm/[token]/actions.ts", import.meta.url),
    "utf8",
  );
  ok("confirm page lookup is by cancel_token", pageSource.includes('.eq("cancel_token", params.token)'));
  ok("confirm page links to cancel page", pageSource.includes("/showing/cancel/"));
  ok("confirm page only shows confirmed state for scheduled rows",
    pageSource.includes("isScheduled && (searchParams.status === \"confirmed\" || row.confirmed_at != null)"));
  ok("confirm action uses admin client", actionSource.includes("createAdminClient"));
  ok("confirm action calls helper", actionSource.includes("confirmShowingByCancelToken(admin, token)"));
}

async function main() {
  await testConfirmHelper();
  await testReminderEmail();
  testSourceWiring();

  console.log(`\nshowing-confirmation: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

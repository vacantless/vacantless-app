// Run with: npx tsx scripts/test-outcome-nudge-send.ts
//
// Tests the send/stamp contract for the post-showing outcome-nudge (P2,
// Best-In-Class QA 2026-07-01): sendOrgNotification must report delivery so the
// cron only stamps outcome_nudge_sent_at when an operator email actually sent.
// A missing BREVO key, an empty recipient resolution, or a disabled event must
// each yield delivered:false so the cron leaves the row unstamped and retries.
//
// No network: BREVO_API_KEY is cleared so sendNotificationEmail returns
// { sent:false } without calling the provider; the Supabase client is a stub.

// Clear the key BEFORE importing so the email module never has one at call time.
delete process.env.BREVO_API_KEY;

import { sendOrgNotification } from "../lib/notifications-server";
import type { SupabaseClient } from "@supabase/supabase-js";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const EVENT_KEY = "leasing.showing_outcome_nudge";

// A minimal chainable stub matching the one settings read sendOrgNotification
// makes: from(..).select(..).eq(..).eq(..).maybeSingle() -> { data }.
function stubClient(settingRow: unknown): SupabaseClient {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: settingRow, error: null }),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

const enabledSetting = {
  event_key: EVENT_KEY,
  enabled: true,
  subject_template: null,
  body_template: null,
  recipients: [] as string[],
  accent_color: null,
};

const org = {
  id: "org-1",
  name: "Test Org",
  brand_color: null,
  logo_url: null,
  reply_to_email: null,
};
const vars = {
  org_name: "Test Org",
  property_address: "1 Test St",
  lead_name: "A renter",
  showing_time: "Mon, Jul 1, 2:00 PM",
  outcome_url: "https://example.com/showing/tok",
};

async function main() {
  // 1) Enabled event, recipients present, but NO BREVO key -> the provider send
  //    returns sent:false, so delivered:false and the cron must NOT stamp.
  const noKey = await sendOrgNotification({
    client: stubClient(enabledSetting),
    org,
    eventKey: EVENT_KEY,
    vars,
    operatorFallback: ["operator@example.com"],
    action: { label: "Record the outcome", url: vars.outcome_url },
  });
  ok("no BREVO key -> delivered false", noKey.delivered === false);
  ok("no BREVO key -> attempted the recipient", noKey.attempted === 1);
  ok("no BREVO key -> sentCount 0", noKey.sentCount === 0);

  // 2) Enabled event but ZERO recipients (no configured list, empty fallback) ->
  //    skipped:no_recipients, delivered:false, attempted 0. Cron must NOT stamp.
  const noRecip = await sendOrgNotification({
    client: stubClient(enabledSetting),
    org,
    eventKey: EVENT_KEY,
    vars,
    operatorFallback: [],
  });
  ok("zero recipients -> delivered false", noRecip.delivered === false);
  ok("zero recipients -> skipped no_recipients", noRecip.skipped === "no_recipients");
  ok("zero recipients -> attempted 0", noRecip.attempted === 0);

  // 3) Event explicitly disabled -> skipped:event_disabled, delivered:false.
  const disabled = await sendOrgNotification({
    client: stubClient({ ...enabledSetting, enabled: false }),
    org,
    eventKey: EVENT_KEY,
    vars,
    operatorFallback: ["operator@example.com"],
  });
  ok("disabled event -> delivered false", disabled.delivered === false);
  ok("disabled event -> skipped event_disabled", disabled.skipped === "event_disabled");

  // 4) Unregistered event key -> skipped:event_inactive, delivered:false.
  const unknown = await sendOrgNotification({
    client: stubClient(enabledSetting),
    org,
    eventKey: "leasing.__does_not_exist__",
    vars,
    operatorFallback: ["operator@example.com"],
  });
  ok("unknown event -> delivered false", unknown.delivered === false);
  ok("unknown event -> skipped event_inactive", unknown.skipped === "event_inactive");

  console.log(`\noutcome-nudge-send: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();

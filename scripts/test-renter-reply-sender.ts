// Unit tests for S669 renter-facing sender aliasing.
// Run: npx tsx scripts/test-renter-reply-sender.ts
import { readFileSync } from "node:fs";

delete process.env.BREVO_SENDER_EMAIL;
process.env.BREVO_API_KEY = "test-key";

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

function stubClient(settingRow: unknown) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: settingRow, error: null }),
  };
  return { from: () => chain };
}

async function main() {
  const { senderOf } = await import("../lib/email");
  const { sendOrgNotification } = await import("../lib/notifications-server");

  process.env.RENTER_FROM_ORG_ALIAS = "0";
  ok("senderOf flag off -> default", senderOf("agile", "Agile").email === "leads@vacantless.com");

  process.env.RENTER_FROM_ORG_ALIAS = "1";
  ok("senderOf flag on with alias", senderOf("agile", "Agile").email === "agile@vacantless.com");
  ok("senderOf keeps org name", senderOf("agile", "Agile").name === "Agile");
  for (const alias of ["leads", "admin", "info", "support", "noreply", "no-reply", "postmaster", "abuse"]) {
    ok(`senderOf reserved ${alias} falls back`, senderOf(alias, "Agile").email === "leads@vacantless.com");
  }
  ok("senderOf u-prefix falls back", senderOf("u-agile", "Agile").email === "leads@vacantless.com");
  ok("senderOf empty falls back", senderOf("", "Agile").email === "leads@vacantless.com");
  ok("senderOf uppercase falls back", senderOf("Agile", "Agile").email === "leads@vacantless.com");
  ok("senderOf dot falls back", senderOf("agile.team", "Agile").email === "leads@vacantless.com");

  const migration = readFileSync("supabase/migrations/0219_renter_reply_routing.sql", "utf8");
  const publicActions = readFileSync("app/r/[propertyId]/actions.ts", "utf8");
  const rescheduleActions = readFileSync("app/showing/reschedule/[token]/actions.ts", "utf8");
  ok("booking extras migration returns mail alias", migration.includes("'mail_alias', o.mail_alias"));
  ok("public booking consumes extras mail alias", publicActions.includes("mailAlias = e.mail_alias ?? mailAlias"));
  ok("reschedule accept consumes extras mail alias", rescheduleActions.includes("mailAlias = e?.mail_alias ?? mailAlias"));

  let captured: any = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    captured = JSON.parse(String(init?.body ?? "{}"));
    return new Response("{}", { status: 201 });
  }) as typeof fetch;

  try {
    const result = await sendOrgNotification({
      client: stubClient({
        event_key: "leasing.new_lead",
        enabled: true,
        subject_template: null,
        body_template: null,
        recipients: [],
        accent_color: null,
      }) as any,
      org: {
        id: "org_1",
        name: "Agile",
        brand_color: null,
        logo_url: null,
        reply_to_email: "rentals@agileonline.ca",
      },
      eventKey: "leasing.new_lead",
      vars: {
        org_name: "Agile",
        property_address: "1551 Assumption",
        lead_name: "Jade",
        lead_email: "jade@example.com",
        lead_phone: "(unknown)",
        move_in: "(not specified)",
        no_suitable_time_note: "",
        screening: "",
        dashboard_url: "https://example.com/dashboard/leads/lead_1",
      },
      operatorFallback: ["operator@example.com"],
    });
    ok("operator notification delivered", result.delivered === true, result);
    ok("operator notification still uses default sender", captured?.sender?.email === "leads@vacantless.com", captured);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`\nrenter-reply-sender: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();

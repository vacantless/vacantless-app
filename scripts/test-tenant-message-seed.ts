// Unit tests for the tenant-message starter template seed (S288).
// Run: npx tsx scripts/test-tenant-message-seed.ts
import {
  TENANT_MESSAGE_TEMPLATE_SEED,
  MESSAGE_TOKENS,
  validateTemplateInput,
  channelIncludesEmail,
  renderForRecipient,
} from "../lib/tenant-comms";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- Shape ------------------------------------------------------------------
ok("seed has 11 templates", TENANT_MESSAGE_TEMPLATE_SEED.length === 11);
ok(
  "names are unique",
  new Set(TENANT_MESSAGE_TEMPLATE_SEED.map((t) => t.name)).size ===
    TENANT_MESSAGE_TEMPLATE_SEED.length,
);
ok(
  "every name is non-empty",
  TENANT_MESSAGE_TEMPLATE_SEED.every((t) => t.name.trim().length > 0),
);
ok(
  "every body is non-empty",
  TENANT_MESSAGE_TEMPLATE_SEED.every((t) => t.body.trim().length > 0),
);
ok(
  "every channel is email|sms|both",
  TENANT_MESSAGE_TEMPLATE_SEED.every((t) =>
    ["email", "sms", "both"].includes(t.channel),
  ),
);

// --- Every seed entry passes the same validation the live save uses ---------
ok(
  "every seed passes validateTemplateInput",
  TENANT_MESSAGE_TEMPLATE_SEED.every(
    (t) =>
      validateTemplateInput({
        name: t.name,
        channel: t.channel,
        subject: t.subject,
        body: t.body,
      }).ok,
  ),
);

// --- Subject discipline: email/both carry one, sms-only does not ------------
ok(
  "email/both templates have a subject",
  TENANT_MESSAGE_TEMPLATE_SEED.filter((t) => channelIncludesEmail(t.channel)).every(
    (t) => (t.subject ?? "").trim().length > 0,
  ),
);
ok(
  "sms-only templates carry no subject",
  TENANT_MESSAGE_TEMPLATE_SEED.filter((t) => t.channel === "sms").every(
    (t) => t.subject === null,
  ),
);

// --- Tokens: only the implemented MESSAGE_TOKENS appear (no raw braces leak) -
// The draft used {{business_name}}/{{rent_amount}}; the implemented slugs are
// {{org_name}}/{{rent}}. An unknown token would render its literal braces, so
// assert every {{token}} used across all subjects+bodies is a real one.
const known = new Set<string>(MESSAGE_TOKENS as readonly string[]);
const usedTokens = new Set<string>();
for (const t of TENANT_MESSAGE_TEMPLATE_SEED) {
  const text = `${t.subject ?? ""}\n${t.body}`;
  for (const m of text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
    usedTokens.add(m[1].toLowerCase());
  }
}
ok(
  "every {{token}} used is a known MESSAGE_TOKEN",
  [...usedTokens].every((tok) => known.has(tok)),
);
ok("no legacy {{business_name}} token", !usedTokens.has("business_name"));
ok("no legacy {{rent_amount}} token", !usedTokens.has("rent_amount"));

// --- No em/en dashes in customer-facing copy (house style) ------------------
ok(
  "no em/en dashes anywhere in the seed",
  TENANT_MESSAGE_TEMPLATE_SEED.every(
    (t) => !/[‒–—―]/.test(`${t.subject ?? ""}${t.body}`),
  ),
);

// --- Rendering: a seed body resolves cleanly for a real recipient -----------
const welcome = TENANT_MESSAGE_TEMPLATE_SEED.find((t) => t.name === "Move-in welcome")!;
const rendered = renderForRecipient(welcome.body, {
  tenantName: "Jordan Lee",
  orgName: "Agile Real Estate Group",
  propertyAddress: "833 Pillette Rd",
  rentCents: 125000,
});
ok("welcome resolves first_name", rendered.includes("Hi Jordan,"));
ok("welcome resolves org_name", rendered.includes("Agile Real Estate Group"));
ok("welcome resolves property_address", rendered.includes("833 Pillette Rd"));
ok("welcome leaves no unresolved braces", !/\{\{/.test(rendered));

// --- S290 contact block: resolves when set, degrades cleanly when unset -----
// The Move-in welcome carries a labeled contact block using the org's public
// contact tokens. The block sits AFTER the always-works "reply to this message"
// line so the message stays usable either way.
ok(
  "welcome carries the contact-block tokens",
  welcome.body.includes("Email: {{business_email}} | Phone: {{business_phone}}"),
);
const withContact = renderForRecipient(welcome.body, {
  tenantName: "Jordan Lee",
  orgName: "Agile Real Estate Group",
  propertyAddress: "833 Pillette Rd",
  rentCents: 125000,
  orgContactEmail: "rentals@agileonline.ca",
  orgContactPhone: "226-773-7555",
});
ok(
  "welcome contact block resolves email + phone when set",
  withContact.includes("Email: rentals@agileonline.ca | Phone: 226-773-7555"),
);
ok("welcome contact block: still has the reply-to-this-message line", withContact.includes("reply to this message"));
// `rendered` (above) was built WITHOUT contact fields: the block degrades to
// blank labels rather than broken prose, and leaves no stray braces.
ok(
  "welcome contact block degrades to blank labels when unset",
  rendered.includes("Email:  | Phone: ") && rendered.includes("reply to this message"),
);

const rentReminder = TENANT_MESSAGE_TEMPLATE_SEED.find((t) => t.name === "Rent reminder")!;
const rr = renderForRecipient(rentReminder.body, {
  tenantName: "Jordan Lee",
  orgName: "Agile",
  propertyAddress: "833 Pillette Rd",
  rentCents: 125000,
});
ok("rent reminder resolves {{rent}} to formatted amount", rr.includes("$1,250/month"));
ok("rent reminder keeps the [due date] operator gap", rr.includes("[due date]"));

// ----------------------------------------------------------------------------
console.log(`tenant-message-seed: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

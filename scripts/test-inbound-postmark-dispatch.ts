// Unit tests for the single Postmark inbound webhook dispatcher.
// Run: npx tsx scripts/test-inbound-postmark-dispatch.ts
import { routePostmarkInbound } from "../lib/inbound-postmark-dispatch";

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

const TOKEN = "abcdefghijklmnopqrstuvwx";

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    MessageID: "mid-dispatch",
    ToFull: [{ Email: `u-${TOKEN}@in.vacantless.com` }],
    FromFull: { Email: "landlord@example.com" },
    Subject: "Receipt",
    TextBody: "Please capture this receipt.",
    Headers: [],
    ...overrides,
  };
}

function portalLeadPayload(overrides: Record<string, unknown> = {}) {
  return basePayload({
    FromFull: { Email: "forwarder@example.com" },
    ReplyTo: "Renter Example <renter@example.com>",
    Subject: "Rentals.ca tenant lead for 50 Glenrose Avenue",
    TextBody: `You have a potential new tenant for 50 Glenrose Avenue

Name: Renter Example
Email: renter@example.com
Phone: (416) 555-0134
Unit: None
Message : I came across your listing for 50 Glenrose Avenue and would be interested in seeing the place.`,
    ...overrides,
  });
}

{
  const result = routePostmarkInbound(basePayload());
  ok("token mail stays on asset route by default", result.target === "asset", result);
  ok("token is returned for asset mail", result.token === TOKEN, result);
}

{
  const result = routePostmarkInbound(basePayload({ ToFull: [{ Email: "agile@in.vacantless.com" }] }));
  ok("ingest-domain alias routes to reply", result.target === "reply", result);
  ok("ingest-domain alias is returned", result.alias === "agile", result);
}

{
  const result = routePostmarkInbound(basePayload({ ToFull: [{ Email: "Agile <agile@vacantless.com>" }] }));
  ok("main-domain alias routes to reply", result.target === "reply", result);
  ok("main-domain alias is returned", result.alias === "agile", result);
}

{
  const result = routePostmarkInbound(basePayload({
    ToFull: [{ Email: `u-${TOKEN}@in.vacantless.com` }],
    CcFull: [{ Email: "agile@in.vacantless.com" }],
  }));
  ok("token wins when token and alias are both present", result.target === "asset", result);
}

{
  const result = routePostmarkInbound(basePayload({ ToFull: [{ Email: "leads@in.vacantless.com" }] }));
  ok("reserved aliases do not route to reply", result.target === "asset", result);
  ok("reserved aliases carry no token", result.token === null, result);
}

{
  const result = routePostmarkInbound(portalLeadPayload());
  ok("parseable portal lead token mail routes to lead", result.target === "lead", result);
  ok("portal lead token is returned", result.token === TOKEN, result);
}

{
  const result = routePostmarkInbound(basePayload({
    FromFull: { Email: "contact@rentals.ca" },
    Subject: "Unreadable lead shape",
    TextBody: "Not enough fields yet.",
  }));
  ok("known portal sender token mail routes to lead", result.target === "lead", result);
}

console.log(`\ninbound-postmark-dispatch: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

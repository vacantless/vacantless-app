// Unit tests for the global trusted-portal-sender registry + ALIGNED auth guard
// (S568, lane B; hardened after Codex P1a/P1b). Run:
//   npx tsx scripts/test-portal-senders.ts
//
// Pins the security-relevant decisions:
//   * a known portal address is governed by the auth guard, NOT by a legacy
//     per-org allow-list row (P1a: no bypass);
//   * trust requires an ALIGNED auth pass — a bare spf=pass for an attacker
//     envelope domain is rejected (P1b);
//   * fail-closed on explicit fail / unaligned pass / no verdict.
import {
  isKnownPortalSender,
  isTrustedPortalSender,
  parseInboundAuthResults,
  domainAligns,
  KNOWN_PORTAL_SENDERS,
} from "../lib/portal-senders";
import { isAllowedSenderEmail } from "../lib/email-ingest";

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

// Mirrors the route's sender decision so the tests exercise the real policy.
function routeAccepts(
  from: string,
  headers: Record<string, string>,
  allowlist: string[],
  enforce: boolean,
): boolean {
  if (isKnownPortalSender(from)) {
    if (isTrustedPortalSender(from, headers)) return true;
    return !enforce; // observe accepts (and logs); enforce rejects
  }
  return isAllowedSenderEmail(from, allowlist);
}

const RENTALS_FROM = '"Rentals.ca" <contact@rentals.ca>';
const RENTALS_NOREPLY = '"Rentals.ca" <no-reply@rentals.ca>';

// Aligned genuine-delivery verdicts.
const AR_DMARC_PASS = {
  "Authentication-Results":
    "mx.forwardemail.net; dkim=pass header.d=rentals.ca; spf=pass smtp.mailfrom=bounce.rentals.ca; dmarc=pass header.from=rentals.ca",
};
const AR_DKIM_ALIGNED = { "Authentication-Results": "mx; dkim=pass header.d=rentals.ca; spf=none" };
const AR_SPF_ALIGNED = { "Authentication-Results": "mx; dkim=none; spf=pass smtp.mailfrom=bounce.rentals.ca" };
const AR_SUBDOMAIN = { "Authentication-Results": "mx; dkim=pass header.d=mail.rentals.ca" };

// Attacker shapes.
const AR_SPF_UNALIGNED = { "Authentication-Results": "mx; spf=pass smtp.mailfrom=attacker.example" };
const AR_DKIM_UNALIGNED = { "Authentication-Results": "mx; dkim=pass header.d=evil.example" };
const AR_ALL_FAIL = {
  "Authentication-Results":
    "mx; dkim=fail header.d=rentals.ca; spf=fail smtp.mailfrom=evil.example; dmarc=fail header.from=rentals.ca",
};

// --- registry / membership --------------------------------------------------
ok("known: contact@rentals.ca", isKnownPortalSender("contact@rentals.ca"));
ok("known: no-reply@rentals.ca", isKnownPortalSender("no-reply@rentals.ca"));
ok("known: display-name + mixed case unwraps", isKnownPortalSender('"Rentals.ca" <Contact@Rentals.CA>'));
ok("unknown: a look-alike domain is NOT trusted", !isKnownPortalSender("contact@rentals.ca.evil.com"));
ok("unknown: a random address is NOT known", !isKnownPortalSender("someone@gmail.com"));
ok("unknown: empty / junk", !isKnownPortalSender("") && !isKnownPortalSender(null) && !isKnownPortalSender("Rentals.ca"));
ok("registry is exact addresses, not a whole domain", !KNOWN_PORTAL_SENDERS.rentals_ca.includes("@rentals.ca"));

// --- alignment helper -------------------------------------------------------
ok("align: exact domain", domainAligns("rentals.ca", "rentals.ca"));
ok("align: subdomain", domainAligns("mail.rentals.ca", "rentals.ca"));
ok("align: email form -> domain", domainAligns("bounce@rentals.ca", "rentals.ca"));
ok("align: different domain is NOT aligned", !domainAligns("attacker.example", "rentals.ca"));
ok("align: look-alike suffix is NOT aligned", !domainAligns("rentals.ca.evil.com", "rentals.ca"));
ok("align: empty", !domainAligns(null, "rentals.ca") && !domainAligns("", "rentals.ca"));

// --- auth verdict + domain parsing ------------------------------------------
ok("parse: dmarc pass", parseInboundAuthResults(AR_DMARC_PASS).dmarc === "pass");
ok("parse: dkim domain scoped to dkim segment", parseInboundAuthResults(AR_DMARC_PASS).dkimDomain === "rentals.ca");
ok("parse: spf mailfrom domain", parseInboundAuthResults(AR_DMARC_PASS).spfDomain === "bounce.rentals.ca");
ok("parse: header name case-insensitive", parseInboundAuthResults({ "authentication-results": "dkim=pass header.d=rentals.ca" }).dkim === "pass");
ok("parse: softfail -> fail", parseInboundAuthResults({ "Authentication-Results": "spf=softfail" }).spf === "fail");
ok("parse: absent -> none", (() => { const v = parseInboundAuthResults({ "X-Rentals-Property-ID": "1" }); return v.dkim === "none" && v.spf === "none" && v.dmarc === "none"; })());
ok("parse: Received-SPF envelope-from fallback", (() => { const v = parseInboundAuthResults({ "Received-SPF": "pass (mx: domain of bounce@rentals.ca) envelope-from=bounce@rentals.ca" }); return v.spf === "pass" && v.spfDomain === "rentals.ca"; })());

// --- trust: aligned passes --------------------------------------------------
ok("trust: dmarc pass -> trusted", isTrustedPortalSender(RENTALS_FROM, AR_DMARC_PASS));
ok("trust: aligned dkim pass -> trusted", isTrustedPortalSender(RENTALS_FROM, AR_DKIM_ALIGNED));
ok("trust: aligned spf pass -> trusted", isTrustedPortalSender(RENTALS_FROM, AR_SPF_ALIGNED));
ok("trust: subdomain dkim aligns -> trusted", isTrustedPortalSender(RENTALS_FROM, AR_SUBDOMAIN));
ok("trust: no-reply variant + dmarc pass -> trusted", isTrustedPortalSender(RENTALS_NOREPLY, AR_DMARC_PASS));

// --- CODEX P1b: unaligned passes are NOT trusted ----------------------------
ok("P1b: spf=pass for attacker envelope -> NOT trusted", !isTrustedPortalSender(RENTALS_FROM, AR_SPF_UNALIGNED));
ok("P1b: dkim=pass for attacker d= -> NOT trusted", !isTrustedPortalSender(RENTALS_FROM, AR_DKIM_UNALIGNED));

// --- fail-closed on fail / absent -------------------------------------------
ok("fail-closed: all fail -> NOT trusted", !isTrustedPortalSender(RENTALS_FROM, AR_ALL_FAIL));
ok("fail-closed: NO auth headers -> NOT trusted", !isTrustedPortalSender(RENTALS_FROM, { "X-Rentals-Property-ID": "1455757" }));
ok("fail-closed: empty headers -> NOT trusted", !isTrustedPortalSender(RENTALS_FROM, {}));

// --- CODEX P1a: legacy per-org rows do NOT bypass the auth guard -------------
const AGILE_LEGACY = ["contact@rentals.ca", "no-reply@rentals.ca"]; // hand-SQL rows
ok("P1a: legacy allow-list alone would have admitted it (the old hole)", isAllowedSenderEmail(RENTALS_FROM, AGILE_LEGACY));
ok("P1a: ENFORCE + legacy rows + failing auth -> REJECTED (no bypass)", routeAccepts(RENTALS_FROM, AR_ALL_FAIL, AGILE_LEGACY, true) === false);
ok("P1a: ENFORCE + legacy rows + aligned pass -> accepted", routeAccepts(RENTALS_FROM, AR_DMARC_PASS, AGILE_LEGACY, true) === true);

// --- CODEX CASE 1: trusted portal sender accepted for a brand-new org --------
ok("new org: per-org allow-list alone rejects the portal sender", !isAllowedSenderEmail(RENTALS_FROM, []));
ok("CASE1: brand-new org (no rows) + aligned pass -> accepted", routeAccepts(RENTALS_FROM, AR_DMARC_PASS, [], true) === true);

// --- CODEX CASE 3: unknown sender still not admitted -------------------------
const unknown = "leads@totally-not-rentals.example";
ok("CASE3: unknown sender not known", !isKnownPortalSender(unknown));
ok("CASE3: unknown sender + empty allow-list -> rejected", routeAccepts(unknown, AR_DMARC_PASS, [], true) === false);
ok("CASE3: unknown sender never gets portal trust", !isTrustedPortalSender(unknown, AR_DMARC_PASS));

// --- observe vs enforce (rollout) -------------------------------------------
ok("observe: failing-auth portal sender is ACCEPTED (accept-but-log)", routeAccepts(RENTALS_FROM, {}, [], false) === true);
ok("enforce: failing-auth portal sender is REJECTED", routeAccepts(RENTALS_FROM, {}, [], true) === false);

// --- CODEX CASE 4 (structural): trust cannot influence org attribution -------
ok("CASE4: trust decision has no org input (orthogonal to attribution)", isTrustedPortalSender.length === 2);

// --- CODEX CASE 5 (regression): the shared per-org primitive is unchanged -----
ok("CASE5: a genuinely verified per-org sender is still admitted (capture flow intact)", isAllowedSenderEmail("landlord@example.com", ["landlord@example.com"]));
ok("CASE5: per-org allow-list still rejects a non-member", !isAllowedSenderEmail("stranger@example.com", ["landlord@example.com"]));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

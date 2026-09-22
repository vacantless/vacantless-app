// Unit tests for lib/portal-inbox (S697c): the self-serve inquiry card's logic.
// Run: npx tsx scripts/test-portal-inbox.ts
import {
  GMAIL_CODE_TTL_MS,
  isGmailForwardingSender,
  isTrustedGoogleMail,
  parseGmailForwardingCode,
  portalIngestEnabled,
  portalInboxSites,
  summarizePortalInbox,
  type PortalInboxEvent,
} from "../lib/portal-inbox";
import { PORTAL_REGISTRY } from "../lib/portal-senders";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
    if (extra !== undefined) console.error("    ->", JSON.stringify(extra));
  }
}

const ON = { KIJIJI_LEAD_INGEST_ENABLED: "true" };
const OFF = {};

// ---- which sites -------------------------------------------------------------
ok("rentals.ca is always on", portalIngestEnabled("rentals_ca", OFF));
ok("kijiji off without its flag", !portalIngestEnabled("kijiji", OFF));
ok("kijiji off on a truthy-looking flag", !portalIngestEnabled("kijiji", { KIJIJI_LEAD_INGEST_ENABLED: "1" }));
ok("kijiji on with the flag", portalIngestEnabled("kijiji", ON));
ok("sites off: only rentals.ca", JSON.stringify(portalInboxSites(OFF).map((s) => s.key)) === '["rentals_ca"]');
ok("sites on: kijiji first", JSON.stringify(portalInboxSites(ON).map((s) => s.key)) === '["kijiji","rentals_ca"]');
const kij = portalInboxSites(ON)[0];
ok("card senders ARE the trusted registry", JSON.stringify(kij.senders) === JSON.stringify(PORTAL_REGISTRY.kijiji.addresses));
ok("card senders are a copy, not the registry array", kij.senders !== PORTAL_REGISTRY.kijiji.addresses);

// ---- Gmail sender + auth -------------------------------------------------------
ok("gmail sender bare", isGmailForwardingSender("forwarding-noreply@google.com"));
ok("gmail sender display name", isGmailForwardingSender("Gmail Team <forwarding-noreply@google.com>"));
ok("gmail sender case", isGmailForwardingSender("FORWARDING-NOREPLY@GOOGLE.COM"));
ok("lookalike refused", !isGmailForwardingSender("forwarding-noreply@google.com.evil.io"));
ok("other google refused", !isGmailForwardingSender("noreply@google.com"));
ok("non-string refused", !isGmailForwardingSender(null));

const AR = (v: string) => ({ "Authentication-Results": v });
ok("dkim google.com trusted", isTrustedGoogleMail(AR("mx; dkim=pass header.d=google.com; spf=softfail smtp.mailfrom=x.example")));
ok("dmarc google.com trusted", isTrustedGoogleMail(AR("mx; dmarc=pass header.from=google.com")));
ok("dmarc pass for another domain refused", !isTrustedGoogleMail(AR("mx; dmarc=pass header.from=evil.io")));
ok("dkim pass other domain refused", !isTrustedGoogleMail(AR("mx; dkim=pass header.d=evil.io")));
ok("dkim lookalike refused", !isTrustedGoogleMail(AR("mx; dkim=pass header.d=google.com.evil.io")));
ok("dkim fail refused", !isTrustedGoogleMail(AR("mx; dkim=fail header.d=google.com")));
ok("no header refused", !isTrustedGoogleMail({}));

// ---- the code --------------------------------------------------------------------
ok("code from subject", parseGmailForwardingCode({ subject: "(#123456789) Gmail Forwarding Confirmation - Receive Mail from a@gmail.com" }) === "123456789");
ok("code from body", parseGmailForwardingCode({ subject: "Gmail Forwarding Confirmation", textBody: "Confirmation code: 987654321\n" }) === "987654321");
ok("subject wins", parseGmailForwardingCode({ subject: "(#111111111) x", textBody: "Confirmation code: 222222222" }) === "111111111");
ok("no code", parseGmailForwardingCode({ subject: "hello", textBody: "no digits" }) === null);
ok("too short refused", parseGmailForwardingCode({ subject: "(#12345) x" }) === null);
ok("letters never pass", parseGmailForwardingCode({ textBody: "Confirmation code: <a href=evil>" }) === null);
ok("null inputs", parseGmailForwardingCode({}) === null);

// ---- summary ---------------------------------------------------------------------
const NOW = Date.parse("2026-09-21T12:00:00Z");
const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const ev = (source: string, outcome: string, h: number, detail: string | null = null): PortalInboxEvent => ({
  source,
  outcome,
  detail,
  received_at: at(h),
});
const sites = portalInboxSites(ON);

let s = summarizePortalInbox(sites, [], NOW);
ok("empty: both not yet", s.sites.every((x) => x.status.state === "none") && s.gmailCode === null);

s = summarizePortalInbox(sites, [ev("kijiji", "lead_created", 5)], NOW);
ok("kijiji working", s.sites[0].status.state === "working" && s.sites[1].status.state === "none");

s = summarizePortalInbox(sites, [ev("kijiji", "duplicate", 1)], NOW);
ok("duplicate counts as working", s.sites[0].status.state === "working");

s = summarizePortalInbox(sites, [ev("kijiji", "lead_created", 50), ev("kijiji", "not_parsed", 2)], NOW);
ok("a newer failure shows", s.sites[0].status.state === "unreadable");

s = summarizePortalInbox(sites, [ev("kijiji", "not_parsed", 50), ev("kijiji", "lead_created", 2)], NOW);
ok("a newer success clears an old failure", s.sites[0].status.state === "working");

s = summarizePortalInbox(sites, [ev("rentals_ca", "auth_unverified", 3)], NOW);
ok("auth failure is its own state", s.sites[1].status.state === "unverified");

s = summarizePortalInbox(sites, [ev("rentals_ca", "cross_org_refused", 3)], NOW);
ok("cross-org shows as unreadable", s.sites[1].status.state === "unreadable");

s = summarizePortalInbox(sites, [ev("gmail_forwarding", "confirmation_code", 1, "123456789")], NOW);
ok("fresh code shown", s.gmailCode?.code === "123456789");

s = summarizePortalInbox(sites, [ev("gmail_forwarding", "confirmation_code", GMAIL_CODE_TTL_MS / 3_600_000 + 1, "123456789")], NOW);
ok("stale code hidden", s.gmailCode === null);

s = summarizePortalInbox(sites, [ev("gmail_forwarding", "confirmation_code", 10, "123456789"), ev("kijiji", "lead_created", 2)], NOW);
ok("code hidden once a site delivered after it", s.gmailCode === null);

s = summarizePortalInbox(sites, [ev("kijiji", "lead_created", 20), ev("gmail_forwarding", "confirmation_code", 2, "123456789")], NOW);
ok("code kept when delivery predates it", s.gmailCode?.code === "123456789");

s = summarizePortalInbox(sites, [ev("gmail_forwarding", "confirmation_code", 1, "<b>x</b>")], NOW);
ok("non-digit detail never shown", s.gmailCode === null);

s = summarizePortalInbox(portalInboxSites(OFF), [ev("kijiji", "lead_created", 1)], NOW);
ok("kijiji events ignored while it is off", s.sites.length === 1 && s.sites[0].key === "rentals_ca");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

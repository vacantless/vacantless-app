// S723: tests for lib/signup-source.ts. Run: npx tsx scripts/test-signup-source.ts
import {
  parseSourceValue,
  captureSource,
  cookieDomainFor,
  describeSource,
  encodeSourceCookie,
  parseSourceCookie,
  referrerHost,
} from "../lib/signup-source";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.log("FAIL:", name, extra ?? "");
  }
}
const now = new Date("2026-10-19T12:00:00Z");
const cap = (qs: string, ref: string | null = null, path = "/") =>
  captureSource({ searchParams: new URLSearchParams(qs), referer: ref, path, now });

// Direct and internal visits record nothing.
check("direct visit", cap("") === null);
check("internal referrer", cap("", "https://app.vacantless.com/dashboard") === null);
check("www internal referrer", cap("", "https://www.vacantless.com/") === null);
check("vercel preview referrer", cap("", "https://vacantless-abc.vercel.app/") === null);
check("junk referrer", cap("", "not a url") === null);

// Google ad click.
const g = cap("utm_source=google&utm_medium=cpc&utm_campaign=ontario-landlords&utm_term=rental+showing+software&gclid=abc", "https://www.google.com/", "/compare/showinghero");
check("google captured", !!g && g.source === "google" && g.gclid === true && g.term === "rental showing software");
check("landing path kept", g?.landing === "/compare/showinghero");
check("referrer host only", g?.referrer === "google.com");
check("google described", describeSource(g) === "Google ads (campaign ontario-landlords, keyword rental showing software)", describeSource(g));

// gclid alone (auto-tagging, no utm).
const g2 = cap("gclid=xyz");
check("gclid alone", describeSource(g2) === "Google ads", describeSource(g2));
check("gbraid counts as google", cap("gbraid=1")?.gclid === true);

// Meta.
const f = cap("utm_source=facebook&utm_medium=paid_social&utm_campaign=windsor&fbclid=1");
check("meta paid", describeSource(f) === "Facebook or Instagram ads (campaign windsor)", describeSource(f));
check("fbclid alone", describeSource(cap("fbclid=zz")) === "Facebook or Instagram", describeSource(cap("fbclid=zz")));
check("instagram organic", describeSource(cap("utm_source=instagram")) === "Facebook or Instagram");

// Other source and plain referral.
check("other utm", describeSource(cap("utm_source=newsletter&utm_medium=email")) === "newsletter / email");
check("plain referral", describeSource(cap("", "https://www.reddit.com/r/landlord")) === "Link from reddit.com");
check("null described", describeSource(null) === "No source recorded");

// Cleaning: no scripts, length capped.
const x = cap("utm_source=<script>alert(1)</script>&utm_campaign=" + "a".repeat(300));
check("angle brackets stripped", !!x && !/[<>()]/.test(x.source ?? ""), x?.source);
check("length capped", (x?.campaign ?? "").length === 80);

// Cookie round trip and tamper.
const rt = parseSourceCookie(encodeSourceCookie(g!));
const sorted = (o: unknown) => JSON.stringify(Object.entries(o ?? {}).sort());
check("round trip", sorted(rt) === sorted(g), rt);
check("garbage cookie", parseSourceCookie("%%%") === null);
check("no at", parseSourceCookie(encodeURIComponent(JSON.stringify({ source: "x" }))) === null);
check("array cookie", parseSourceCookie(encodeURIComponent("[1]")) === null);
check("tampered values recleaned", parseSourceCookie(encodeURIComponent(JSON.stringify({ at: now.toISOString(), source: "<b>x</b>", gclid: "yes" })))?.source === "bx/b");
check("gclid must be true", parseSourceCookie(encodeURIComponent(JSON.stringify({ at: now.toISOString(), gclid: "yes" })))?.gclid === undefined);
check("unknown keys dropped", !("evil" in (parseSourceCookie(encodeURIComponent(JSON.stringify({ at: now.toISOString(), evil: "1" }))) ?? {})));

// Stored jsonb value.
check("stored value", parseSourceValue({ at: now.toISOString(), source: "google", gclid: true })?.source === "google");
check("stored null", parseSourceValue(null) === null);
check("stored string", parseSourceValue("x") === null);

// Cookie domain.
check("www domain", cookieDomainFor("www.vacantless.com") === ".vacantless.com");
check("app domain", cookieDomainFor("app.vacantless.com:443") === ".vacantless.com");
check("apex domain", cookieDomainFor("vacantless.com") === ".vacantless.com");
check("preview domain", cookieDomainFor("vacantless-x.vercel.app") === undefined);
check("lookalike domain", cookieDomainFor("evilvacantless.com") === undefined);
check("referrer lookalike is outside", referrerHost("https://notvacantless.com/") === "notvacantless.com");

console.log(`signup-source: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

// S806: a rental site account that uses the Vacantless address. Renters come
// straight in; the site's own emails (codes, links, resets) go to the owner.
// Run: npx tsx scripts/test-site-mail-pass.ts
import { readFileSync } from "node:fs";
import {
  isTrustedSiteMail,
  linkOnSite,
  siteConfirmLink,
  siteMailCopyLead,
  siteMailCopySubject,
  siteMailDomain,
} from "../lib/site-mail-pass";
import { openSiteConfirmLink } from "../lib/site-mail-pass-server";
import { siteMailCopyHtml } from "../lib/email";
import { handleInboundLeadPost } from "../lib/portal-lead-ingest-server";
import { DEFAULT_INGEST_DOMAIN, ingestAddressFromToken } from "../lib/email-ingest";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${name}`, extra === undefined ? "" : JSON.stringify(extra));
  }
}
const read = (p: string) => readFileSync(p, "utf8");

// --- which mail is a site's ------------------------------------------------------
ok("kijiji subdomain", siteMailDomain("Kijiji <noreply@mail.kijiji.ca>") === "kijiji.ca");
ok("rentals.ca", siteMailDomain("no-reply@rentals.ca") === "rentals.ca");
ok("zumper", siteMailDomain("support@zumper.com") === "zumper.com");
ok("look-alike refused", siteMailDomain("x@kijiji.ca.evil.com") === null && siteMailDomain("x@notkijiji.ca") === null);
ok("stranger refused", siteMailDomain("pat@gmail.com") === null);

const DKIM = (d: string) => ({ "Authentication-Results": `mx.postmarkapp.com; dkim=pass header.d=${d}; spf=none` });
ok("aligned dkim trusted", isTrustedSiteMail("noreply@mail.kijiji.ca", DKIM("kijiji.ca")).ok);
ok("dkim for another domain refused", !isTrustedSiteMail("noreply@kijiji.ca", DKIM("evil.com")).ok);
ok("no auth refused", !isTrustedSiteMail("noreply@kijiji.ca", {}).ok);
// S815: the header Rentals.ca's sign-up email really carried (2026-11-17): a quoted mailfrom.
ok(
  "quoted spf mailfrom on a rentals.ca subdomain trusted",
  isTrustedSiteMail("no-reply@rentals.ca", {
    "Authentication-Results": 'mx; dkim=none; spf=pass smtp.mailfrom="bounces+123@em3909.rentals.ca"; dmarc=none',
  }).ok,
);
ok(
  "quoted spf mailfrom for another domain still refused",
  !isTrustedSiteMail("no-reply@rentals.ca", {
    "Authentication-Results": 'mx; spf=pass smtp.mailfrom="bounce@rentals.ca.evil.com"',
  }).ok,
);
ok(
  "aligned spf trusted",
  isTrustedSiteMail("no-reply@rentals.ca", { "Authentication-Results": "mx; dkim=none; spf=pass smtp.mailfrom=bounce.rentals.ca" }).ok,
);
ok(
  "dmarc pass for another from refused",
  !isTrustedSiteMail("no-reply@rentals.ca", { "Authentication-Results": "mx; dmarc=pass header.from=evil.com" }).ok,
);

ok("subject names the site", siteMailCopySubject("Kijiji", "Confirm your email") === "Kijiji: Confirm your email");
ok("empty subject", siteMailCopySubject("Zumper", "  ") === "Zumper sent you an email");
const html = siteMailCopyHtml({
  to_email: "o@x.com",
  org_name: "Org",
  site_name: "Kijiji",
  subject: "s",
  lead_line: "Kijiji sent this.",
  original_from: "noreply@kijiji.ca",
  html: '<p>Click <a href="https://kijiji.ca/confirm?t=1">confirm</a></p><script>alert(1)</script>',
  text: null,
});
ok("site link kept", html.includes('href="https://kijiji.ca/confirm?t=1"'));
ok("script removed", !html.includes("<script"));
const textHtml = siteMailCopyHtml({
  to_email: "o@x.com",
  org_name: null,
  site_name: "Rentals.ca",
  subject: "s",
  lead_line: "l",
  original_from: "f",
  html: null,
  text: "Your code is 123456. <b>https://rentals.ca/x</b>",
});
ok("text escaped", textHtml.includes("&lt;b&gt;"));
ok("text link clickable", textHtml.includes('<a href="https://rentals.ca/x"'));

// --- the ingest ------------------------------------------------------------------
const SECRET = "s";
const TOKEN = "abcdefghijklmnopqrstuvwx";
const ORG = "8ea1da48-0000-0000-0000-000000000001";
const TO = ingestAddressFromToken(TOKEN, DEFAULT_INGEST_DOMAIN);

let addressActive = true;
class Chain {
  private active: unknown = undefined;
  constructor(private table: string) {}
  select() { return this; }
  eq(col?: string, val?: unknown) {
    if (col === "active") this.active = val;
    return this;
  }
  neq() { return this; }
  not() { return this; }
  is() { return this; }
  in() { return this; }
  gte() { return this; }
  ilike() { return this; }
  order() { return this; }
  limit() { return this; }
  async maybeSingle() {
    if (this.table !== "org_ingest_addresses") return { data: null, error: null };
    return { data: this.active === addressActive ? { organization_id: ORG } : null, error: null };
  }
  then(resolve: (v: unknown) => unknown) {
    return Promise.resolve({ data: [], error: null }).then(resolve);
  }
}
const admin = { from: (t: string) => new Chain(t), rpc: async () => ({ data: null, error: null }) };

async function post(from: string, headers: Record<string, string>, subject = "Confirm your email") {
  const passedOn: Array<{ siteName: string; subject: string }> = [];
  const res = await handleInboundLeadPost(
    {
      url: `https://app.test/api/inbound/lead?key=${SECRET}`,
      headers: new Headers(),
      json: async () => ({
        From: from,
        To: TO,
        Subject: subject,
        HtmlBody: "<p>hi</p>",
        TextBody: "hi",
        Headers: Object.entries(headers).map(([Name, Value]) => ({ Name, Value })),
      }),
    } as never,
    {
      admin: admin as never,
      secret: SECRET,
      recordPortalEvent: async () => {},
      notifyOperators: async () => {},
      readEnquiry: async () => null as never,
      passSiteMail: async (_a, o) => {
        passedOn.push({ siteName: o.siteName, subject: o.subject });
        return { sent: 1, attempted: 1 };
      },
    },
  );
  return { body: (await res.json()) as Record<string, unknown>, passedOn };
}

async function main() {
  const a = await post("Kijiji <noreply@mail.kijiji.ca>", DKIM("kijiji.ca"));
  ok("kijiji account mail passed on", a.body.handled === "site_mail_passed" && a.passedOn[0]?.siteName === "Kijiji", a.body);
  const b = await post("noreply@mail.kijiji.ca", {});
  ok("unauthenticated site mail not passed", b.passedOn.length === 0 && b.body.handled !== "site_mail_passed", b.body);
  const c = await post("Zumper <support@zumper.com>", { "Authentication-Results": "mx; dmarc=pass header.from=zumper.com" });
  ok("zumper dmarc passed on", c.body.handled === "site_mail_passed" && c.passedOn[0]?.siteName === "Zumper", c.body);
  const d = await post("pat@gmail.com", { "Authentication-Results": "mx; dkim=pass header.d=gmail.com" });
  ok("a stranger is never passed on", d.passedOn.length === 0, d.body);

  // Rotated address: nothing is filed, but a trusted site email still reaches the owner.
  addressActive = false;
  const e = await post("Kijiji <noreply@mail.kijiji.ca>", DKIM("kijiji.ca"));
  ok("rotated address passes site mail on", e.body.handled === "site_mail_passed" && e.body.rotated === true && e.passedOn.length === 1, e.body);
  const f = await post("pat@gmail.com", {});
  ok("rotated address drops a stranger", f.body.handled === "rotated_address" && f.passedOn.length === 0, f.body);
  addressActive = true;
}

// --- wiring ----------------------------------------------------------------------
const ingest = read("lib/portal-lead-ingest-server.ts");
ok("pass-through before the loop guard", ingest.indexOf("if (!isKnownPortalSender(from)) {\n    const passed = await passOn();") < ingest.indexOf("isAutoReplyOrLoop(loopHeaders)"));
ok("not parsed is recorded, then passed on", /await note\("not_parsed"\);[\s\S]{0,200}const passed = await passOn\(\);/.test(ingest));
const signin = read("app/dashboard/site-signin/[channel]/page.tsx");
ok("sign-up fills the Vacantless address", signin.includes("defaultValue={vacantlessAddress ?? user?.email ??"));
ok("sign-up says why", signin.includes("come straight in"));
const en = JSON.parse(read("messages/en.json"));
ok("card says the easiest way", typeof en.portalInbox.siteAccountTip === "string" && en.portalInbox.howTitle === "Or set up a rule in your email");
const server = read("lib/site-mail-pass-server.ts");
ok("copies go to owners", server.includes('.eq("role", "owner_admin")'));
ok("a closed account's closer still gets them", server.includes("closed_by") && server.includes("emails.length === 0 && closedBy"));
ok("closed page says to change the site email", read("app/account-closed/page.tsx").includes("change it on that site to your own email"));
ok("rotate says to change site accounts", read("app/dashboard/captures/page.tsx").includes("change that account to the new one"));

// --- S817c: the site's confirm link is opened for the landlord ----------------------
// Shaped like the real Rentals.ca "Email Validation" email of 2026-11-17 (Postmark
// 79bcb03b): tracked links everywhere, the button's words "Validate".
const rcHtml = `<a href="https://url6872.rentals.ca/ls/click?upn=u001.logo">
  <img src="https://rentals.ca/static/fe/img/emails/rentals-email-logo-white.png"></a>
  <h1>Email validation</h1><p>Click the confirmation button below to validate your Rentals.ca account email</p>
  <a href="https://url6872.rentals.ca/ls/click?upn=u001.TOKEN&amp;x=1" style="background:#000"><span>Validate</span></a>
  <a href="https://url6872.rentals.ca/ls/click?upn=u001.tiktok">TikTok</a>`;
const rcLink = siteConfirmLink({ domain: "rentals.ca", subject: "Rentals.ca Email Validation", html: rcHtml, text: null });
ok("finds the Validate button, not the logo", rcLink === "https://url6872.rentals.ca/ls/click?upn=u001.TOKEN&x=1", rcLink);
ok("a password reset is never opened", siteConfirmLink({ domain: "rentals.ca", subject: "Password recovery request for Rentals.ca", html: rcHtml.replace("Validate", "Reset password"), text: null }) === null);
ok("a reset with a verify word is still never opened", siteConfirmLink({ domain: "rentals.ca", subject: "Verify your email to reset your password", html: rcHtml, text: null }) === null);
ok("a log-in code email is not a confirmation", siteConfirmLink({ domain: "rentals.ca", subject: "Your Rentals.ca Listing - Verification Required", html: rcHtml, text: null }) === null);
ok("a button off the site's domain is refused", siteConfirmLink({ domain: "rentals.ca", subject: "Verify your email", html: '<a href="https://rentals.ca.evil.com/v?t=1">Verify email</a>', text: null }) === null);
ok("plain http is refused", !linkOnSite("http://rentals.ca/validate?t=1", "rentals.ca"));
ok("subdomain on https is fine", linkOnSite("https://url6872.rentals.ca/ls/click?x=1", "rentals.ca"));
ok("Kijiji style button", siteConfirmLink({ domain: "kijiji.ca", subject: "Please verify your email address", html: '<a href="https://www.kijiji.ca/t-activate.html?token=abc">Verify email address</a>', text: null }) === "https://www.kijiji.ca/t-activate.html?token=abc");
ok("plain-text confirm link", siteConfirmLink({ domain: "zumper.com", subject: "Confirm your email", html: null, text: "Confirm your email here:\nhttps://www.zumper.com/confirm?t=9\n" }) === "https://www.zumper.com/confirm?t=9");
ok("copy line says it was confirmed", siteMailCopyLead("Rentals.ca", true).includes("We already opened its confirm link for you"));
ok("copy line unchanged when not", siteMailCopyLead("Rentals.ca") === "Rentals.ca sent this to your Vacantless address. It is not from a renter, so we passed it on to you.");
const serverSrc = read("lib/site-mail-pass-server.ts");
ok("confirm only runs on the trusted path (domain from isTrustedSiteMail)", read("lib/portal-lead-ingest-server.ts").split("domain: trust.domain,").length === 3);
ok("the confirm happens before the copy is sent", serverSrc.indexOf("siteConfirmLink(") < serverSrc.indexOf("sendSiteMailCopy({"));

async function confirmFetchTests() {
  const seen: string[] = [];
  const fake = (async (url: string) => {
    seen.push(String(url));
    if (String(url).includes("ls/click")) return new Response(null, { status: 302, headers: { location: "https://rentals.ca/?validated" } });
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;
  const r = await openSiteConfirmLink("https://url6872.rentals.ca/ls/click?upn=u001.T", "rentals.ca", fake);
  ok("follows the site's own redirect and reports opened", r.opened && r.status === 200 && r.host === "rentals.ca" && seen.length === 2, { r, seen });
  const off = (async () => new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } })) as unknown as typeof fetch;
  const r2 = await openSiteConfirmLink("https://url6872.rentals.ca/ls/click?upn=u001.T", "rentals.ca", off);
  ok("stops at a redirect off the site", !r2.opened, r2);
  const boom = (async () => {
    throw new Error("network");
  }) as unknown as typeof fetch;
  ok("never throws", !(await openSiteConfirmLink("https://rentals.ca/v", "rentals.ca", boom)).opened);
}

confirmFetchTests().then(() => main()).then(() => {
  console.log(`\nsite-mail-pass: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});

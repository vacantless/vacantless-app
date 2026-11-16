// S806: a rental site account that uses the Vacantless address. Renters come
// straight in; the site's own emails (codes, links, resets) go to the owner.
// Run: npx tsx scripts/test-site-mail-pass.ts
import { readFileSync } from "node:fs";
import {
  isTrustedSiteMail,
  siteMailCopySubject,
  siteMailDomain,
} from "../lib/site-mail-pass";
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

main().then(() => {
  console.log(`\nsite-mail-pass: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});

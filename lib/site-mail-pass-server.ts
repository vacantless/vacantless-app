// S806: pass a rental site's own email (lib/site-mail-pass) on to the account
// owners. Owners and admins get it: sign-up links, codes and password resets
// belong to whoever holds the account, not to the leasing team. Never throws.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserByIdCached } from "./auth-email-cache";
import { loadExtraRecipients, withExtras } from "./message-recipients-server";
import { sendSiteMailCopy } from "./email";
import { linkOnSite, siteConfirmLink, siteMailCopyLead, siteMailCopySubject } from "./site-mail-pass";

/**
 * S817c: open a site's confirm link from the server, the way a click would.
 * Follows redirects only while they stay on the site's domain. Never throws.
 */
export async function openSiteConfirmLink(
  href: string,
  domain: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ opened: boolean; status: number | null; host: string | null }> {
  let url = href;
  try {
    for (let hop = 0; hop < 6; hop++) {
      if (!linkOnSite(url, domain)) return { opened: false, status: null, host: null };
      const res = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36", accept: "text/html" },
        signal: AbortSignal.timeout(10_000),
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        url = new URL(loc, url).toString();
        continue;
      }
      return { opened: res.status >= 200 && res.status < 400, status: res.status, host: new URL(url).hostname };
    }
    return { opened: false, status: null, host: null };
  } catch (err) {
    console.warn("site-mail-pass: confirm link failed", { error: err instanceof Error ? err.message : String(err) });
    return { opened: false, status: null, host: null };
  }
}

const MAX_COPIES = 5;

export async function passSiteMailToOwners(
  admin: SupabaseClient,
  opts: {
    orgId: string;
    siteName: string;
    /** S817c: the site's domain; when set, a confirmation email's link is opened first. */
    domain?: string;
    from: string;
    subject: string;
    html: string | null;
    text: string | null;
  },
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<{ sent: number; attempted: number; confirmed?: boolean }> {
  try {
    // S817c: a "confirm your email" from the site: open its link for the landlord.
    let confirmed = false;
    if (opts.domain) {
      const link = siteConfirmLink({ domain: opts.domain, subject: opts.subject, html: opts.html, text: opts.text });
      if (link) {
        const r = await openSiteConfirmLink(link, opts.domain, deps.fetchImpl);
        confirmed = r.opened;
        console.log("site-mail-pass: confirm link", { org: opts.orgId, site: opts.domain, opened: r.opened, status: r.status, host: r.host });
      }
    }
    const { data: org } = await admin
      .from("organizations")
      .select("name, reply_to_email, closed_by")
      .eq("id", opts.orgId)
      .maybeSingle();
    const { data: memberRows } = await admin
      .from("memberships")
      .select("user_id, role")
      .eq("organization_id", opts.orgId)
      .eq("role", "owner_admin");
    const emails: string[] = [];
    for (const m of (memberRows ?? []) as { user_id: string }[]) {
      const { data: u } = await getUserByIdCached(admin, m.user_id);
      const e = u?.user?.email?.trim().toLowerCase();
      if (e && !emails.includes(e)) emails.push(e);
    }
    // A closed account has no logins left (closeAccount deletes memberships).
    // Its site accounts may still use this address, so the person who closed
    // it keeps getting the sites' emails (password resets included) until the
    // stored data is deleted.
    const closedBy = (org as { closed_by: string | null } | null)?.closed_by ?? null;
    if (emails.length === 0 && closedBy) {
      const { data: u } = await getUserByIdCached(admin, closedBy);
      const e = u?.user?.email?.trim().toLowerCase();
      if (e) emails.push(e);
    }
    const fallback = (org as { reply_to_email: string | null } | null)?.reply_to_email?.trim().toLowerCase();
    if (emails.length === 0 && fallback) emails.push(fallback);
    // S824j: plus "Also send to" addresses, never on a closed account.
    const extras = closedBy ? [] : await loadExtraRecipients(admin, opts.orgId, "you-site-mail");
    const to = withExtras(emails.slice(0, MAX_COPIES), extras);
    const results = await Promise.allSettled(
      to.map((email) =>
        sendSiteMailCopy({
          to_email: email,
          org_name: (org as { name: string | null } | null)?.name ?? null,
          site_name: opts.siteName,
          subject: siteMailCopySubject(opts.siteName, opts.subject),
          lead_line: siteMailCopyLead(opts.siteName, confirmed),
          original_from: opts.from,
          html: opts.html,
          text: opts.text,
        }),
      ),
    );
    const sent = results.filter((r) => r.status === "fulfilled" && r.value.sent).length;
    return { sent, attempted: to.length, confirmed };
  } catch (err) {
    console.error("site-mail-pass: copy failed", { error: err instanceof Error ? err.message : String(err) });
    return { sent: 0, attempted: 0 };
  }
}

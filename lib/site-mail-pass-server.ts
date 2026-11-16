// S806: pass a rental site's own email (lib/site-mail-pass) on to the account
// owners. Owners and admins get it: sign-up links, codes and password resets
// belong to whoever holds the account, not to the leasing team. Never throws.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserByIdCached } from "./auth-email-cache";
import { sendSiteMailCopy } from "./email";
import { siteMailCopyLead, siteMailCopySubject } from "./site-mail-pass";

const MAX_COPIES = 5;

export async function passSiteMailToOwners(
  admin: SupabaseClient,
  opts: {
    orgId: string;
    siteName: string;
    from: string;
    subject: string;
    html: string | null;
    text: string | null;
  },
): Promise<{ sent: number; attempted: number }> {
  try {
    const { data: org } = await admin
      .from("organizations")
      .select("name, reply_to_email")
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
    const fallback = (org as { reply_to_email: string | null } | null)?.reply_to_email?.trim().toLowerCase();
    if (emails.length === 0 && fallback) emails.push(fallback);
    const to = emails.slice(0, MAX_COPIES);
    const results = await Promise.allSettled(
      to.map((email) =>
        sendSiteMailCopy({
          to_email: email,
          org_name: (org as { name: string | null } | null)?.name ?? null,
          site_name: opts.siteName,
          subject: siteMailCopySubject(opts.siteName, opts.subject),
          lead_line: siteMailCopyLead(opts.siteName),
          original_from: opts.from,
          html: opts.html,
          text: opts.text,
        }),
      ),
    );
    const sent = results.filter((r) => r.status === "fulfilled" && r.value.sent).length;
    return { sent, attempted: to.length };
  } catch (err) {
    console.error("site-mail-pass: copy failed", { error: err instanceof Error ? err.message : String(err) });
    return { sent: 0, attempted: 0 };
  }
}

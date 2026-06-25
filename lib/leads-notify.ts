// Pure recipient resolution for the leasing.new_lead notification (the first
// Agile→Vacantless teardown event, replacing Zap 362007976). The analog of
// resolveIncidentNotifyEmails (lib/incident-reports.ts) but gated on the
// manage_leads capability instead of manage_work_orders, because a new-lead
// alert is for whoever works the leasing pipeline. NO I/O here — the caller
// (the anon submit-lead path) fetches members + org fallbacks via the admin
// client and passes them in. Unit-tested via scripts/test-leads-notify.ts.

import { roleCan } from "./roles";
import type { NotifyMember } from "./incident-reports";

// Trim + lowercase + require a bare "@" so a blank / obviously-bad address is
// dropped before the provider sees it (deliverability is the provider's job).
function normalizeNotifyEmail(email: string | null | undefined): string | null {
  const t = (email ?? "").trim().toLowerCase();
  return t && t.includes("@") ? t : null;
}

/**
 * Resolve who gets the "new lead" email: every org member whose role holds
 * manage_leads, by usable email, deduped. When NO member email resolves (e.g.
 * emails not yet readable on the anon path), fall back to the FIRST usable
 * address in `fallbacks` (the org's reply-to / public contact) so the team
 * still hears about it. Unknown/missing roles never qualify (roleCan floors
 * them to the most restrictive role). Pure + tested.
 *
 * NOTE: this is the *default* audience only. The customizable substrate
 * (notification_settings.recipients) overrides it per-org via the Settings →
 * Notifications tab; this list is passed as `operatorFallback`.
 */
export function resolveLeadNotifyEmails(
  members: NotifyMember[],
  fallbacks: (string | null | undefined)[] = [],
): string[] {
  const out = new Set<string>();
  for (const m of members ?? []) {
    if (!roleCan(m.role, "manage_leads")) continue;
    const e = normalizeNotifyEmail(m.email);
    if (e) out.add(e);
  }
  if (out.size === 0) {
    for (const f of fallbacks) {
      const e = normalizeNotifyEmail(f);
      if (e) {
        out.add(e);
        break; // one fallback address is enough
      }
    }
  }
  return [...out];
}

// Pure recipient resolution for the leasing.new_lead notification (the first
// Agile→Vacantless teardown event, replacing Zap 362007976). The analog of
// resolveIncidentNotifyEmails (lib/incident-reports.ts) but gated on the
// manage_leads capability instead of manage_work_orders, because a new-lead
// alert is for whoever works the leasing pipeline. NO I/O here — the caller
// (the anon submit-lead path) fetches members + org fallbacks via the admin
// client and passes them in. Unit-tested via scripts/test-leads-notify.ts.

import { roleCan } from "./roles";
import type { NotifyMember } from "./incident-reports";
import type { CustomAnswerSnapshot } from "./screening-questions";

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

/**
 * Resolve operator-alert recipients with the safe fallback order used by live
 * renter events: leasing-role members first, then any real member/login email,
 * then public renter-facing org contacts as the last resort. This keeps
 * concierge/proxy onboarding from alerting an intended landlord before handoff
 * when the public contact field is staged with their real email.
 */
export function resolveLeadNotifyEmailsPreferMemberFallback(
  members: NotifyMember[],
  publicFallbacks: (string | null | undefined)[] = [],
): string[] {
  const anyMemberEmail =
    (members ?? []).map((m) => m.email).find((e) => normalizeNotifyEmail(e)) ?? null;
  return resolveLeadNotifyEmails(members, [anyMemberEmail, ...publicFallbacks]);
}

// --- Screening block for the new-lead email ({{screening}} token) -----------
// The notification-parity payload (S332): turn a lead's screening snapshot into
// a labeled, multi-line PLAIN-TEXT block so the leasing.new_lead email shows
// Occupants / Pets / income / custom answers (Employment, Other units of
// interest, …) inline — the email-first operator (Aaliyah) sees the screening
// without opening the dashboard. Pure string work; the caller passes the
// already-fetched snapshot. Labels + value formatting mirror the lead-detail
// page so the email reads identically to the dashboard. The values are renter-
// supplied; the branded shell escapes them at render (bodyToParagraphs ->
// escapeHtml), so no HTML can be injected here.

export type LeadScreeningSnapshot = {
  screen_income_cents: number | null;
  screen_occupants: number | null;
  screen_has_pets: boolean | null;
  screen_pets_detail: string | null;
  screen_custom_answers: CustomAnswerSnapshot[] | null;
};

/**
 * Build the {{screening}} token value. Includes only the fields the org actually
 * collected (a missing field is omitted, never shown as blank), in the same
 * order + with the same labels as the lead-detail page: Occupants, Pets, Stated
 * monthly income, then each custom answer by its snapshotted prompt. Returns ""
 * when nothing was collected (so the surrounding blank lines in the template
 * collapse and the email still reads cleanly). When non-empty it starts with a
 * "Screening" header line so the block is visually grouped in the email.
 */
export function formatLeadScreeningBlock(
  s: LeadScreeningSnapshot | null | undefined,
): string {
  if (!s) return "";
  const lines: string[] = [];

  if (s.screen_occupants != null) {
    lines.push(`Occupants: ${s.screen_occupants}`);
  }

  const petsDetail = (s.screen_pets_detail ?? "").trim();
  if (s.screen_has_pets != null || petsDetail !== "") {
    const pets = petsDetail !== "" ? petsDetail : s.screen_has_pets ? "Yes" : "No";
    lines.push(`Pets: ${pets}`);
  }

  if (s.screen_income_cents != null) {
    lines.push(
      `Stated monthly income: $${(s.screen_income_cents / 100).toLocaleString("en-CA")}`,
    );
  }

  for (const a of s.screen_custom_answers ?? []) {
    if (!a) continue;
    const answer = (a.answer ?? "").trim();
    if (answer === "") continue;
    const value = a.qtype === "yesno" ? (answer === "yes" ? "Yes" : "No") : answer;
    lines.push(`${a.prompt}: ${value}`);
  }

  if (lines.length === 0) return "";
  return ["Screening", ...lines].join("\n");
}

// S726: renters whose email Brevo will not deliver to (KI to be numbered at wrap).
//
// Brevo adds a one-click List-Unsubscribe to every send. A renter who clicks
// Gmail's "Unsubscribe", reports spam, or whose address hard-bounces lands on
// Brevo's transactional blocklist, and every later email to them is dropped
// with no error on our side (Bansee Patel, Agile, 2026-10-20: the "new viewing
// times" email went out as "Notified" but Brevo blocked it).
//
// The 15-minute team-unsubscribe-guard sweep already reads that blocklist. It
// now also records each blocked RENTER address once in email_delivery_events
// (kind "blocklist"), and records kind "blocklist_cleared" if the address later
// leaves the list. The renter's choice stands: we never unblock a renter.
// Automatic renter emails (nurture, new-times notice) skip a blocked address,
// and the renter page says so, so the landlord texts or calls instead.

export const BLOCKLIST_KIND = "blocklist";
export const BLOCKLIST_CLEARED_KIND = "blocklist_cleared";

export type DeliveryRow = {
  email: string | null;
  event: string | null;
  kind: string | null;
  reason?: string | null;
  occurred_at: string | null;
};

export function normEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  return e.includes("@") ? e : null;
}

/** Plain words for Brevo's blocklist reason codes. */
export function blockReasonWords(code: string | null | undefined): string {
  switch (code) {
    case "unsubscribedViaEmail":
    case "unsubscribedViaApi":
    case "unsubscribedViaMA":
      return "they unsubscribed";
    case "hardBounce":
      return "the address bounced";
    case "contactFlaggedAsSpam":
      return "they marked an email as spam";
    case "adminBlocked":
      return "the address was blocked";
    default:
      return "the email service blocked the address";
  }
}

function isBlockRow(r: DeliveryRow): boolean {
  return r.event === "blocked" || r.event === "spam";
}
function isClearRow(r: DeliveryRow): boolean {
  return r.event === "delivered" || (r.event === "other" && r.kind === BLOCKLIST_CLEARED_KIND);
}

/** Latest state per address: blocked if the newest block/clear row is a block. Pure. */
export function blockedFromEvents(rows: DeliveryRow[]): Map<string, { since: string; reason: string | null }> {
  const latest = new Map<string, DeliveryRow>();
  for (const r of rows) {
    const e = normEmail(r.email);
    if (!e || !(isBlockRow(r) || isClearRow(r))) continue;
    const t = Date.parse(r.occurred_at ?? "");
    if (!Number.isFinite(t)) continue;
    const cur = latest.get(e);
    if (!cur || Date.parse(cur.occurred_at ?? "") <= t) latest.set(e, r);
  }
  const out = new Map<string, { since: string; reason: string | null }>();
  for (const [e, r] of latest) if (isBlockRow(r)) out.set(e, { since: r.occurred_at as string, reason: r.reason ?? null });
  return out;
}

export type BlockedContact = { email: string; reason?: { code?: string } | null; blockedAt?: string };
export type LeadEmailRow = { id: string; organization_id: string; email: string | null };

/**
 * Rows to insert so each renter address on the blocklist is recorded once,
 * and each recorded address that left the list is cleared once. Team
 * addresses are skipped (the guard unblocks those). Pure.
 */
export function blocklistRowsToRecord(input: {
  blocked: BlockedContact[];
  team: Set<string>;
  leads: LeadEmailRow[];
  recorded: DeliveryRow[]; // existing blocklist / blocklist_cleared rows for these emails
  nowIso: string;
}) {
  const onList = new Map<string, BlockedContact>();
  for (const b of input.blocked) {
    const e = normEmail(b.email);
    if (e && !input.team.has(e)) onList.set(e, b);
  }
  // Current recorded state per address, from blocklist rows only.
  const recordedState = new Map<string, "blocked" | "cleared">();
  const lastAt = new Map<string, number>();
  for (const r of input.recorded) {
    const e = normEmail(r.email);
    if (!e || (r.kind !== BLOCKLIST_KIND && r.kind !== BLOCKLIST_CLEARED_KIND)) continue;
    const t = Date.parse(r.occurred_at ?? "") || 0;
    if (t >= (lastAt.get(e) ?? -1)) {
      lastAt.set(e, t);
      recordedState.set(e, r.kind === BLOCKLIST_KIND ? "blocked" : "cleared");
    }
  }
  const rows: Array<{
    organization_id: string; lead_id: string; email: string; kind: string;
    event: "blocked" | "other"; reason: string | null; occurred_at: string;
  }> = [];
  const seenLead = new Set<string>();
  for (const l of input.leads) {
    const e = normEmail(l.email);
    if (!e || seenLead.has(l.id)) continue;
    seenLead.add(l.id);
    const b = onList.get(e);
    const state = recordedState.get(e);
    if (b && state !== "blocked") {
      const at = b.blockedAt && Number.isFinite(Date.parse(b.blockedAt)) ? new Date(b.blockedAt).toISOString() : input.nowIso;
      rows.push({ organization_id: l.organization_id, lead_id: l.id, email: e, kind: BLOCKLIST_KIND, event: "blocked", reason: b.reason?.code ?? null, occurred_at: at });
    } else if (!b && state === "blocked") {
      rows.push({ organization_id: l.organization_id, lead_id: l.id, email: e, kind: BLOCKLIST_CLEARED_KIND, event: "other", reason: null, occurred_at: input.nowIso });
    }
  }
  return rows;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** Addresses (lower-cased) that automatic renter emails must skip. */
export async function loadBlockedRenterEmails(admin: Admin, emails: Array<string | null | undefined>): Promise<Set<string>> {
  const list = Array.from(new Set(emails.map(normEmail).filter((e): e is string => !!e)));
  const out = new Set<string>();
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    const { data, error } = await admin
      .from("email_delivery_events")
      .select("email, event, kind, reason, occurred_at")
      .in("email", chunk)
      .in("event", ["blocked", "spam", "delivered", "other"]);
    if (error) continue; // never stop a send sweep over this check
    for (const e of blockedFromEvents((data ?? []) as DeliveryRow[]).keys()) out.add(e);
  }
  return out;
}

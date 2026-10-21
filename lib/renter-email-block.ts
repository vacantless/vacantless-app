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
    // S728: a recorded unsubscribe stands even once Brevo's block is lifted.
    // Exact (lower-cased) match here; the send gate itself matches any case.
    const { data: opted } = await admin
      .from("leads")
      .select("email")
      .not("email_opt_out_at", "is", null)
      .in("email", chunk);
    for (const r of (opted ?? []) as Array<{ email: string | null }>) {
      const e = normEmail(r.email);
      if (e) out.add(e);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// S728: one gate for every renter email, transactional or marketing.
//
// Brevo's one-click unsubscribe lands on its transactional blocklist and
// Brevo then drops EVERY later email to that address, including the renter's
// own booking confirmation and reminders, while our send reads as ok. Brevo
// only lets Enterprise plans drop that header. So:
//   - an unsubscribe is recorded on the lead (leads.email_opt_out_at) and
//     every MARKETING kind (nurture, new viewing times, waitlist, price drop)
//     skips that renter for good;
//   - a TRANSACTIONAL kind (booking confirmation, reminders, time changes,
//     auto-reply, application invite, feedback) lifts the Brevo block when
//     the reason was an unsubscribe click, because the renter asked for that
//     email by booking. Bounces, spam reports and admin blocks are never
//     lifted: the email is not sent and the caller gets a reason.
// ---------------------------------------------------------------------------

export const MARKETING_EMAIL_KINDS = new Set([
  "nurture_email",
  "viewing_times_opened",
  "waitlist_vacancy_alert",
  "price_drop_alert",
]);

export const TRANSACTIONAL_RENTER_EMAIL_KINDS = new Set([
  "booking_confirmation",
  "reschedule_proposal",
  "reschedule_accepted_confirmation",
  "showing_rescheduled",
  "showing_auto_released",
  "feedback_request",
  "auto_reply",
  "rental_application_invite",
]);

export const UNSUBSCRIBE_REASONS = new Set(["unsubscribedViaEmail", "unsubscribedViaApi", "unsubscribedViaMA"]);

/** reminder_24h, reminder_same_day, reminder_2h are transactional too. Pure. */
export function emailKindClass(kind: string | null | undefined): "marketing" | "transactional" | "other" {
  if (!kind) return "other";
  if (MARKETING_EMAIL_KINDS.has(kind)) return "marketing";
  if (TRANSACTIONAL_RENTER_EMAIL_KINDS.has(kind) || kind.startsWith("reminder_")) return "transactional";
  return "other";
}

/** The "kind:x" tag out of a Brevo tags array. Pure. */
export function kindFromTags(tags: unknown): string | null {
  if (!Array.isArray(tags)) return null;
  for (const t of tags) {
    if (typeof t === "string" && t.startsWith("kind:")) return t.slice(5);
  }
  return null;
}

export type GateVerdict = { allow: true; unblocked?: boolean } | { allow: false; reason: string };

/**
 * Decide, from the block state and the opt-out flag, whether this kind may go
 * to this renter. Pure; the caller performs the Brevo unblock when asked.
 */
export function gateVerdict(input: {
  kindClass: "marketing" | "transactional" | "other";
  optedOut: boolean;
  block: { reason: string | null } | null;
}): { allow: boolean; reason?: string; liftBlock?: boolean } {
  if (input.kindClass === "other") return { allow: true };
  if (input.kindClass === "marketing") {
    if (input.optedOut) return { allow: false, reason: "renter_opted_out" };
    if (input.block) return { allow: false, reason: `address_blocked:${input.block.reason ?? "unknown"}` };
    return { allow: true };
  }
  // transactional
  if (!input.block) return { allow: true };
  if (UNSUBSCRIBE_REASONS.has(input.block.reason ?? "")) return { allow: true, liftBlock: true };
  return { allow: false, reason: `address_blocked:${input.block.reason ?? "unknown"}` };
}

/** Lead rows for an address, any case. */
async function leadsForEmail(admin: Admin, email: string): Promise<Array<{ id: string; organization_id: string; email_opt_out_at: string | null }>> {
  const { data } = await admin
    .from("leads")
    .select("id, organization_id, email_opt_out_at")
    .ilike("email", email.replace(/[%_]/g, (c: string) => "\\" + c));
  return (data ?? []) as Array<{ id: string; organization_id: string; email_opt_out_at: string | null }>;
}

/** Record a renter's unsubscribe on every lead that carries the address. */
export async function markRenterEmailOptOut(admin: Admin, email: string | null | undefined, atIso: string): Promise<number> {
  const e = normEmail(email);
  if (!e) return 0;
  const leads = await leadsForEmail(admin, e);
  const ids = leads.filter((l) => !l.email_opt_out_at).map((l) => l.id);
  if (ids.length === 0) return 0;
  const { error } = await admin.from("leads").update({ email_opt_out_at: atIso }).in("id", ids);
  return error ? 0 : ids.length;
}

/**
 * Lift Brevo's block for an address whose block was an unsubscribe click,
 * because the renter has just asked for a transactional email. Records the
 * lift in email_delivery_events so the block state reads clear; the opt-out
 * on the lead keeps marketing off. Never throws.
 */
export async function liftBrevoBlockForTransactional(admin: Admin, email: string, apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.brevo.com/v3/smtp/blockedContacts/${encodeURIComponent(email)}`, {
      method: "DELETE",
      headers: { "api-key": apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    // 204 lifted; 404 means it was not on the list after all. Both fine.
    if (!res.ok && res.status !== 404) return false;
    const leads = await leadsForEmail(admin, email);
    const now = new Date().toISOString();
    if (leads.length > 0) {
      await admin.from("email_delivery_events").insert(
        leads.map((l) => ({
          organization_id: l.organization_id,
          lead_id: l.id,
          email,
          kind: BLOCKLIST_CLEARED_KIND,
          event: "other",
          reason: "lifted_for_transactional",
          occurred_at: now,
        })),
      );
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * The gate every renter send passes through (called from the Brevo send
 * helper). Returns allow:false with a reason the caller can record, or
 * allow:true after lifting a Brevo unsubscribe block for a transactional kind.
 * Fails open on a database error for transactional kinds (a booking
 * confirmation is worth more than this check) and closed for marketing kinds.
 */
export async function gateRenterEmail(
  admin: Admin | null,
  email: string | null | undefined,
  kind: string | null,
  apiKey: string,
): Promise<GateVerdict> {
  const cls = emailKindClass(kind);
  if (cls === "other") return { allow: true };
  const e = normEmail(email);
  // No database client (tests, a misconfigured build): the sweeps that send
  // marketing kinds already checked the block list themselves.
  if (!e || !admin) return { allow: true };
  try {
    const [leads, { data: delivery }] = await Promise.all([
      leadsForEmail(admin, e),
      admin
        .from("email_delivery_events")
        .select("email, event, kind, reason, occurred_at")
        .eq("email", e)
        .in("event", ["blocked", "spam", "delivered", "other"]),
    ]);
    const optedOut = leads.some((l) => !!l.email_opt_out_at);
    const block = blockedFromEvents((delivery ?? []) as DeliveryRow[]).get(e) ?? null;
    const v = gateVerdict({ kindClass: cls, optedOut, block });
    if (!v.allow) return { allow: false, reason: v.reason ?? "blocked" };
    if (v.liftBlock) {
      const lifted = await liftBrevoBlockForTransactional(admin, e, apiKey);
      if (!lifted) return { allow: false, reason: "address_blocked:unsubscribed_not_lifted" };
      return { allow: true, unblocked: true };
    }
    return { allow: true };
  } catch (err) {
    return cls === "marketing" ? { allow: false, reason: `gate_error:${(err as Error).message}` } : { allow: true };
  }
}
